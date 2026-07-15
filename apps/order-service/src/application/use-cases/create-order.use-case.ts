import { v4 as uuidv4 } from 'uuid';
import { OrderRepository } from '../../domain/repositories/order.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { KafkaTopic, OrderStatus } from '@ecommerce/shared';
import { BadRequestError, ConflictError } from '@ecommerce/errors';
import { withTransaction } from '../../infrastructure/db/pool';
import { CreateOrderDto } from '../dtos/order.dto';
import { Order } from '../../domain/entities/order.entity';

interface ProductInfo {
  productId: string;
  agentId: string;
  productName: string;
  productImage?: string;
  unitPrice: number;
}

export interface ShippingPolicy {
  agentId: string;
  baseShippingFee: number;
  freeShippingThreshold?: number;
  remoteAreaFee?: number;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'FIXED' | 'PERCENT';
  discountValue: number;
  minOrderAmount: number;
  maxDiscountAmount?: number;
  startsAt: Date;
  expiresAt?: Date;
  usageLimit?: number;
  usedCount: number;
  perUserLimit: number;
  isActive: boolean;
}

export function calculateCouponDiscount(coupon: Coupon, merchandiseTotal: number, userRedemptions: number, now = new Date()): number {
  if (!coupon.isActive || now < coupon.startsAt || (coupon.expiresAt != null && now >= coupon.expiresAt)) {
    throw new BadRequestError('Coupon is inactive or outside its validity period');
  }
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) throw new BadRequestError('Coupon usage limit has been reached');
  if (userRedemptions >= coupon.perUserLimit) throw new BadRequestError('Coupon per-user usage limit has been reached');
  if (merchandiseTotal < coupon.minOrderAmount) throw new BadRequestError('Order does not meet the coupon minimum amount');

  const raw = coupon.discountType === 'FIXED'
    ? coupon.discountValue
    : Math.max(1, Math.floor(merchandiseTotal * coupon.discountValue / 100));
  const limited = coupon.maxDiscountAmount == null ? raw : Math.min(raw, coupon.maxDiscountAmount);
  return Math.min(merchandiseTotal, limited);
}

export function allocateOrderDiscount<T extends { subtotal: number }>(items: T[], discountAmount: number): Array<T & { discountAmount: number }> {
  const total = items.reduce((sum, item) => sum + item.subtotal, 0);
  if (!Number.isSafeInteger(discountAmount) || discountAmount < 0 || discountAmount > total) {
    throw new BadRequestError('Invalid order discount amount');
  }
  let allocated = 0;
  return items.map((item, index) => {
    const itemDiscount = index === items.length - 1
      ? discountAmount - allocated
      : Math.floor(discountAmount * item.subtotal / total);
    allocated += itemDiscount;
    return { ...item, discountAmount: itemDiscount };
  });
}

export function isRemotePostalCode(postalCode: string, prefixes: string[]): boolean {
  const normalized = postalCode.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return prefixes.some((prefix) => normalized.startsWith(prefix.replace(/[^0-9A-Za-z]/g, '').toUpperCase()));
}

export function calculateShippingFees(items: Array<{ agentId: string; subtotal: number }>, policies: Map<string, ShippingPolicy>, remoteArea = false): Map<string, number> {
  const subtotals = new Map<string, number>();
  for (const item of items) subtotals.set(item.agentId, (subtotals.get(item.agentId) ?? 0) + item.subtotal);
  return new Map([...subtotals].map(([agentId, subtotal]) => {
    const policy = policies.get(agentId);
    if (!policy || !Number.isInteger(policy.baseShippingFee) || policy.baseShippingFee < 0) {
      throw new BadRequestError(`Shipping policy not found or invalid for agent: ${agentId}`);
    }
    const remoteAreaFee = policy.remoteAreaFee ?? 0;
    if (!Number.isInteger(remoteAreaFee) || remoteAreaFee < 0) throw new BadRequestError(`Shipping policy not found or invalid for agent: ${agentId}`);
    const isFree = policy.freeShippingThreshold != null && subtotal >= policy.freeShippingThreshold;
    return [agentId, (isFree ? 0 : policy.baseShippingFee) + (remoteArea ? remoteAreaFee : 0)];
  }));
}

export class CreateOrderUseCase {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async replayIfExists(dto: CreateOrderDto, userId: string): Promise<Order | null> {
    const existing = await this.orderRepo.findByIdempotencyKey(userId, dto.idempotencyKey);
    return existing ? this.replay(existing, dto) : null;
  }

  async execute(dto: CreateOrderDto, userId: string, productInfoMap: Map<string, ProductInfo>, shippingPolicies: Map<string, ShippingPolicy>, remoteArea = false): Promise<Order> {
    const existing = await this.replayIfExists(dto, userId);
    if (existing) return existing;
    if (dto.items.some((item) => !productInfoMap.has(item.productId))) throw new BadRequestError('One or more products not found');

    const orderId = uuidv4();
    const sagaId = uuidv4();
    const unpricedItems = dto.items.map((item) => {
      const info = productInfoMap.get(item.productId)!;
      return {
        orderId,
        productId: item.productId,
        agentId: info.agentId,
        productName: info.productName,
        productImage: info.productImage,
        quantity: item.quantity,
        unitPrice: info.unitPrice,
        subtotal: info.unitPrice * item.quantity,
      };
    });
    const shippingFees = calculateShippingFees(unpricedItems, shippingPolicies, remoteArea);
    const allocatedAgents = new Set<string>();
    const items = unpricedItems.map((item) => {
      const shippingFee = allocatedAgents.has(item.agentId) ? 0 : shippingFees.get(item.agentId)!;
      allocatedAgents.add(item.agentId);
      return { ...item, shippingFee };
    });
    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
    const shippingFee = [...shippingFees.values()].reduce((sum, fee) => sum + fee, 0);

    let transactionResult: { order: Order; replayed: boolean };
    try {
      transactionResult = await withTransaction(async (client) => {
        const concurrent = await this.orderRepo.findByIdempotencyKey(userId, dto.idempotencyKey, client);
        if (concurrent) return { order: concurrent, replayed: true };

        let discountAmount = 0;
        let couponId: string | undefined;
        if (dto.couponCode) {
          const coupon = await this.orderRepo.findCouponForUpdate(dto.couponCode, client);
          if (!coupon) throw new BadRequestError('Coupon not found');
          const userRedemptions = await this.orderRepo.countCouponRedemptions(coupon.id, userId, client);
          discountAmount = calculateCouponDiscount(coupon, totalAmount, userRedemptions);
          couponId = coupon.id;
        }
        const discountedItems = allocateOrderDiscount(items, discountAmount);

        const persisted = await this.orderRepo.create({
          id: orderId,
          sagaId,
          userId,
          status: OrderStatus.PENDING,
          shippingAddress: dto.shippingAddress,
          totalAmount,
          shippingFee,
          discountAmount,
          finalAmount: totalAmount + shippingFee - discountAmount,
          couponCode: dto.couponCode,
          idempotencyKey: dto.idempotencyKey,
          createdAt: new Date(),
          updatedAt: new Date(),
        }, discountedItems, client);
        if (couponId) await this.orderRepo.recordCouponRedemption(couponId, orderId, userId, discountAmount, client);
        await this.orderRepo.createSaga({
          sagaId,
          orderId,
          status: 'STARTED',
          items: discountedItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            agentId: item.agentId,
            unitPrice: item.unitPrice,
            discountAmount: item.discountAmount,
            shippingFee: item.shippingFee,
          })),
          createdAt: new Date(),
          updatedAt: new Date(),
        }, client);
        return { order: persisted, replayed: false };
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const concurrent = await this.orderRepo.findByIdempotencyKey(userId, dto.idempotencyKey);
      if (!concurrent) throw error;
      return this.replay(concurrent, dto);
    }

    if (transactionResult.replayed) return this.replay(transactionResult.order, dto);
    const order = transactionResult.order;

    await this.publishCreated(order, order.items);
    return order;
  }

  private async replay(order: Order, dto: CreateOrderDto): Promise<Order> {
    const requested = [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId));
    const persisted = [...order.items].sort((a, b) => a.productId.localeCompare(b.productId));
    const matches = requested.length === persisted.length
      && requested.every((item, index) => item.productId === persisted[index].productId && item.quantity === persisted[index].quantity)
      && JSON.stringify(dto.shippingAddress) === JSON.stringify(order.shippingAddress)
      && dto.couponCode === order.couponCode;
    if (!matches) throw new ConflictError('Idempotency key is already used for another order');
    await this.publishCreated(order, order.items);
    return order;
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
  }

  private async publishCreated(order: Order, items: Order['items']): Promise<void> {
    await this.kafkaProducer.send(KafkaTopic.ORDER_CREATED, {
      topic: KafkaTopic.ORDER_CREATED,
      payload: {
        orderId: order.id,
        sagaId: order.sagaId,
        userId: order.userId,
        items: items.map((item) => ({
          productId: item.productId,
          agentId: item.agentId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          shippingFee: item.shippingFee,
        })),
        totalAmount: order.totalAmount,
        shippingFee: order.shippingFee,
        discountAmount: order.discountAmount,
        finalAmount: order.finalAmount,
        shippingAddress: order.shippingAddress,
      },
    }, order.sagaId);
  }
}
