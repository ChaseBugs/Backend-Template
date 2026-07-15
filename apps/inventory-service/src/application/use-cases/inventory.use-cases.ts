import { v4 as uuidv4 } from 'uuid';
import { InventoryRepository } from '../../domain/repositories/inventory.repository';
import { StockManager, RedisClient } from '@ecommerce/redis-client';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { KafkaTopic } from '@ecommerce/shared';
import { NotFoundError, BadRequestError } from '@ecommerce/errors';
import { withTransaction } from '../../infrastructure/db/pool';
import { Logger } from '@ecommerce/logger';

export interface ReserveItemsInput {
  orderId: string;
  sagaId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface InventoryMetrics {
  recordReservation(result: 'success' | 'failure'): void;
  recordCacheLookup(result: 'hit' | 'miss'): void;
}

const NOOP_METRICS: InventoryMetrics = {
  recordReservation: () => {},
  recordCacheLookup: () => {},
};

export class InventoryUseCases {
  private readonly stockManager: StockManager;

  constructor(
    private readonly repo: InventoryRepository,
    private readonly redis: RedisClient,
    private readonly kafkaProducer: KafkaProducer,
    private readonly logger: Logger,
    private readonly transaction: typeof withTransaction = withTransaction,
    private readonly metrics: InventoryMetrics = NOOP_METRICS,
  ) {
    this.stockManager = new StockManager(redis);
  }

  async setStock(productId: string, agentId: string, quantity: number): Promise<void> {
    if (!Number.isInteger(quantity) || quantity < 0) throw new BadRequestError('Stock quantity must be a non-negative integer');
    const existing = await this.repo.findByProductId(productId);
    if (existing && existing.agentId !== agentId) {
      throw new BadRequestError('Product does not belong to this agent');
    }
    if (existing && quantity < existing.reservedQuantity) {
      throw new BadRequestError('Stock quantity cannot be lower than reserved quantity');
    }

    await this.transaction(async (client) => {
      const updated = await this.repo.upsert(productId, agentId, quantity, client);
      if (!updated) throw new BadRequestError('Stock update conflicts with product ownership or reserved quantity');
      await this.repo.createMovement(
        { id: uuidv4(), productId, type: 'ADJUST', quantity, note: 'Manual stock set' },
        client,
      );
    });
    await this.stockManager.setStock(productId, quantity);
    await this.publishInventoryUpdated(productId);
  }

  async adjustStock(productId: string, delta: number, agentId: string, note?: string): Promise<void> {
    if (!Number.isInteger(delta) || delta === 0) throw new BadRequestError('Stock adjustment must be a non-zero integer');
    const inventory = await this.repo.findByProductId(productId);
    if (!inventory) throw new NotFoundError('Inventory', productId);
    if (inventory.agentId !== agentId) throw new BadRequestError('Product does not belong to this agent');

    await this.transaction(async (client) => {
      const updated = await this.repo.adjustQuantity(productId, delta, client);
      if (!updated) throw new BadRequestError('Stock adjustment would reduce quantity below reserved stock');
      await this.repo.createMovement(
        { id: uuidv4(), productId, type: delta > 0 ? 'IN' : 'OUT', quantity: Math.abs(delta), note },
        client,
      );
    });

    const current = await this.repo.findByProductId(productId);
    if (current) await this.stockManager.setStock(productId, current.quantity - current.reservedQuantity);
    await this.publishInventoryUpdated(productId);
  }

  async getStock(productId: string): Promise<{ productId: string; available: number; reserved: number }> {
    const cachedAvailable = await this.stockManager.getStock(productId);
    const inventory = await this.repo.findByProductId(productId);
    if (!inventory) throw new NotFoundError('Inventory', productId);

    const databaseAvailable = inventory.quantity - inventory.reservedQuantity;
    const cacheValid = cachedAvailable === databaseAvailable;
    this.metrics.recordCacheLookup(cacheValid ? 'hit' : 'miss');
    if (!cacheValid) await this.stockManager.setStock(productId, databaseAvailable);

    return { productId, available: databaseAvailable, reserved: inventory.reservedQuantity };
  }

  // SAGA: reserve stock for multiple items atomically
  async reserveItems(input: ReserveItemsInput): Promise<void> {
    let failedProductId: string | undefined;
    let newlyReserved = false;

    try {
      // PostgreSQL is the source of truth. Each conditional UPDATE takes a row
      // lock, and the surrounding transaction rolls every reservation back if
      // any product cannot be reserved.
      const cancelled = await this.transaction(async (client) => {
        for (const item of input.items) {
          // A cancellation may be consumed before ORDER_CREATED because Kafka
          // ordering is not guaranteed across different topics. RELEASE acts
          // as a tombstone that prevents a late reservation.
          if (await this.repo.hasMovement(item.productId, 'RELEASE', input.orderId, client)) return true;
          if (await this.repo.hasMovement(item.productId, 'RESERVE', input.orderId, client)) continue;
          const reserved = await this.repo.reserve(item.productId, item.quantity, client);
          if (!reserved) {
            failedProductId = item.productId;
            throw new Error('INVENTORY_RESERVATION_FAILED');
          }
          newlyReserved = true;
          await this.repo.createMovement(
            {
              id: uuidv4(),
              productId: item.productId,
              type: 'RESERVE',
              quantity: item.quantity,
              referenceId: input.orderId,
            },
            client,
          );
        }
        return false;
      });
      if (cancelled) {
        this.logger.info({ orderId: input.orderId }, 'Ignoring late inventory reservation for cancelled order');
        return;
      }
    } catch (error) {
      if (!failedProductId) throw error;
      this.metrics.recordReservation('failure');
      await this.kafkaProducer.send(
        KafkaTopic.INVENTORY_RESERVATION_FAILED,
        {
          topic: KafkaTopic.INVENTORY_RESERVATION_FAILED,
          payload: {
            orderId: input.orderId,
            sagaId: input.sagaId,
            reason: 'Insufficient stock',
            failedProductId,
          },
        },
        input.sagaId,
      );
      return;
    }

    // Refresh the cache only after the database transaction commits.
    for (const item of input.items) {
      const inventory = await this.repo.findByProductId(item.productId);
      if (inventory) {
        await this.stockManager.setStock(item.productId, inventory.quantity - inventory.reservedQuantity);
      }
      await this.publishInventoryUpdated(item.productId);
    }

    await this.kafkaProducer.send(
      KafkaTopic.INVENTORY_RESERVED,
      {
        topic: KafkaTopic.INVENTORY_RESERVED,
        payload: { orderId: input.orderId, sagaId: input.sagaId, items: input.items },
      },
      input.sagaId,
    );
    if (newlyReserved) this.metrics.recordReservation('success');
  }

  // SAGA compensate: release reservation on payment failure / order cancel
  async releaseItems(orderId: string, sagaId: string, items: Array<{ productId: string; quantity: number }>): Promise<void> {
    await this.transaction(async (client) => {
      for (const item of items) {
        if (await this.repo.hasMovement(item.productId, 'RELEASE', orderId, client)) continue;
        const hadReservation = await this.repo.hasMovement(item.productId, 'RESERVE', orderId, client);
        if (hadReservation) {
          const released = await this.repo.releaseReservation(item.productId, item.quantity, client);
          if (!released) throw new Error(`Reserved inventory could not be released for product ${item.productId}`);
        }
        await this.repo.createMovement(
          { id: uuidv4(), productId: item.productId, type: 'RELEASE', quantity: item.quantity, referenceId: orderId },
          client,
        );
      }
    });

    for (const item of items) {
      const inventory = await this.repo.findByProductId(item.productId);
      if (inventory) await this.stockManager.setStock(item.productId, inventory.quantity - inventory.reservedQuantity);
      await this.publishInventoryUpdated(item.productId);
    }

    await this.kafkaProducer.send(
      KafkaTopic.INVENTORY_RELEASED,
      { topic: KafkaTopic.INVENTORY_RELEASED, payload: { orderId, sagaId, items } },
      sagaId,
    );
  }

  // SAGA confirm: after payment success, move reserved → deducted
  async confirmDeduction(orderId: string, items: Array<{ productId: string; quantity: number }>): Promise<void> {
    const deducted = await this.transaction(async (client) => {
      const results: Array<{ productId: string; agentId: string; quantity: number; available: number; lowStockThreshold: number; newlyDeducted: boolean }> = [];
      for (const item of items) {
        if (await this.repo.hasMovement(item.productId, 'OUT', orderId, client)) {
          const existing = await this.repo.findByProductId(item.productId, client);
          if (existing) results.push({
            productId: item.productId,
            agentId: existing.agentId,
            quantity: item.quantity,
            available: existing.quantity - existing.reservedQuantity,
            lowStockThreshold: existing.lowStockThreshold,
            newlyDeducted: false,
          });
          continue;
        }
        const inventory = await this.repo.deductReserved(item.productId, item.quantity, client);
        await this.repo.createMovement(
          { id: uuidv4(), productId: item.productId, type: 'OUT', quantity: item.quantity, referenceId: orderId },
          client,
        );
        results.push({
          productId: item.productId,
          agentId: inventory.agentId,
          quantity: item.quantity,
          available: inventory.quantity - inventory.reservedQuantity,
          lowStockThreshold: inventory.lowStockThreshold,
          newlyDeducted: true,
        });
      }
      return results;
    });

    await this.kafkaProducer.send(
      KafkaTopic.INVENTORY_DEDUCTED,
      { topic: KafkaTopic.INVENTORY_DEDUCTED, payload: {
        orderId,
        items: deducted.map(({ productId, quantity, available }) => ({ productId, quantity, available })),
      } },
      orderId,
    );
    for (const item of deducted) {
      if (!item.newlyDeducted || item.available > item.lowStockThreshold) continue;
      await this.kafkaProducer.send(
        KafkaTopic.STOCK_LOW,
        { topic: KafkaTopic.STOCK_LOW, payload: {
          productId: item.productId,
          agentId: item.agentId,
          available: item.available,
          threshold: item.lowStockThreshold,
        } },
        item.productId,
      );
    }
  }

  private async publishInventoryUpdated(productId: string): Promise<void> {
    const inventory = await this.repo.findByProductId(productId);
    if (!inventory) return;
    await this.kafkaProducer.send(
      KafkaTopic.INVENTORY_UPDATED,
      { topic: KafkaTopic.INVENTORY_UPDATED, payload: {
        productId,
        agentId: inventory.agentId,
        available: inventory.quantity - inventory.reservedQuantity,
        reserved: inventory.reservedQuantity,
      } },
      productId,
    );
  }
}
