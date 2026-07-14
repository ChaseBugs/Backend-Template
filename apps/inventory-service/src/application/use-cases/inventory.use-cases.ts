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

export class InventoryUseCases {
  private readonly stockManager: StockManager;

  constructor(
    private readonly repo: InventoryRepository,
    private readonly redis: RedisClient,
    private readonly kafkaProducer: KafkaProducer,
    private readonly logger: Logger,
  ) {
    this.stockManager = new StockManager(redis);
  }

  async setStock(productId: string, agentId: string, quantity: number): Promise<void> {
    const existing = await this.repo.findByProductId(productId);
    if (existing && existing.agentId !== agentId) {
      throw new BadRequestError('Product does not belong to this agent');
    }

    await withTransaction(async (client) => {
      await this.repo.upsert(productId, agentId, quantity, client);
      await this.repo.createMovement(
        { id: uuidv4(), productId, type: 'ADJUST', quantity, note: 'Manual stock set' },
        client,
      );
    });
    await this.stockManager.setStock(productId, quantity);
  }

  async adjustStock(productId: string, delta: number, agentId: string, note?: string): Promise<void> {
    const inventory = await this.repo.findByProductId(productId);
    if (!inventory) throw new NotFoundError('Inventory', productId);
    if (inventory.agentId !== agentId) throw new BadRequestError('Product does not belong to this agent');

    await withTransaction(async (client) => {
      const updated = await this.repo.adjustQuantity(productId, delta, client);
      if (updated.quantity < 0) throw new BadRequestError('Insufficient stock for adjustment');
      await this.repo.createMovement(
        { id: uuidv4(), productId, type: delta > 0 ? 'IN' : 'OUT', quantity: Math.abs(delta), note },
        client,
      );
    });

    const current = await this.stockManager.getStock(productId);
    if (current !== null) {
      await this.stockManager.setStock(productId, current + delta);
    }
  }

  async getStock(productId: string): Promise<{ productId: string; available: number; reserved: number }> {
    const redisStock = await this.stockManager.getStock(productId);
    if (redisStock !== null) {
      return { productId, available: redisStock, reserved: 0 };
    }

    const inventory = await this.repo.findByProductId(productId);
    if (!inventory) throw new NotFoundError('Inventory', productId);

    const available = inventory.quantity - inventory.reservedQuantity;
    await this.stockManager.setStock(productId, available);

    return { productId, available, reserved: inventory.reservedQuantity };
  }

  // SAGA: reserve stock for multiple items atomically
  async reserveItems(input: ReserveItemsInput): Promise<void> {
    const failed: string[] = [];

    // First attempt via Redis Lua script for speed
    for (const item of input.items) {
      const result = await this.stockManager.deductStock(item.productId, item.quantity);
      if (result < 0) {
        failed.push(item.productId);
        break;
      }
    }

    if (failed.length > 0) {
      // Rollback successful deductions
      for (const item of input.items) {
        if (!failed.includes(item.productId)) {
          const current = await this.stockManager.getStock(item.productId);
          if (current !== null) {
            await this.stockManager.setStock(item.productId, current + item.quantity);
          }
        }
      }

      await this.kafkaProducer.send(
        KafkaTopic.INVENTORY_RESERVATION_FAILED,
        {
          topic: KafkaTopic.INVENTORY_RESERVATION_FAILED,
          payload: {
            orderId: input.orderId,
            sagaId: input.sagaId,
            reason: 'Insufficient stock',
            failedProductId: failed[0],
          },
        },
        input.sagaId,
      );
      return;
    }

    // Persist to PostgreSQL
    await withTransaction(async (client) => {
      for (const item of input.items) {
        await this.repo.reserve(item.productId, item.quantity, client);
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
    });

    await this.kafkaProducer.send(
      KafkaTopic.INVENTORY_RESERVED,
      {
        topic: KafkaTopic.INVENTORY_RESERVED,
        payload: { orderId: input.orderId, sagaId: input.sagaId, items: input.items },
      },
      input.sagaId,
    );
  }

  // SAGA compensate: release reservation on payment failure / order cancel
  async releaseItems(orderId: string, sagaId: string, items: Array<{ productId: string; quantity: number }>): Promise<void> {
    await withTransaction(async (client) => {
      for (const item of items) {
        await this.repo.releaseReservation(item.productId, item.quantity, client);
        await this.repo.createMovement(
          { id: uuidv4(), productId: item.productId, type: 'RELEASE', quantity: item.quantity, referenceId: orderId },
          client,
        );
        const inv = await this.repo.findByProductId(item.productId, client);
        if (inv) await this.stockManager.setStock(item.productId, inv.quantity - inv.reservedQuantity);
      }
    });

    await this.kafkaProducer.send(
      KafkaTopic.INVENTORY_RELEASED,
      { topic: KafkaTopic.INVENTORY_RELEASED, payload: { orderId, sagaId, items } },
      sagaId,
    );
  }

  // SAGA confirm: after payment success, move reserved → deducted
  async confirmDeduction(orderId: string, items: Array<{ productId: string; quantity: number }>): Promise<void> {
    await withTransaction(async (client) => {
      for (const item of items) {
        await this.repo.deductReserved(item.productId, item.quantity, client);
        await this.repo.createMovement(
          { id: uuidv4(), productId: item.productId, type: 'OUT', quantity: item.quantity, referenceId: orderId },
          client,
        );
      }
    });

    await this.kafkaProducer.send(
      KafkaTopic.INVENTORY_DEDUCTED,
      { topic: KafkaTopic.INVENTORY_DEDUCTED, payload: { orderId, items } },
      orderId,
    );
  }
}
