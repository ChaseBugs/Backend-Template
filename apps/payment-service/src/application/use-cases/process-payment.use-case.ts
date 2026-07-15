import CircuitBreaker from 'opossum';
import { v4 as uuidv4 } from 'uuid';
import { PaymentRepository, RefundRecord } from '../../domain/repositories/payment.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { RedisClient } from '@ecommerce/redis-client';
import { KafkaTopic, PaymentStatus } from '@ecommerce/shared';
import { BadRequestError, ConflictError, ServiceUnavailableError } from '@ecommerce/errors';
import { withTransaction } from '../../infrastructure/db/pool';
import { Payment, PaymentMethod } from '../../domain/entities/payment.entity';
import { config } from '../../config';
import { Logger } from '@ecommerce/logger';
import { allocateRefundToSettlements } from '../settlement-adjustment';

export interface InitiatePaymentInput {
  orderId: string;
  sagaId: string;
  userId: string;
  amount: number;
  method: PaymentMethod;
  idempotencyKey: string;
}

export interface PGResponse {
  transactionId: string;
  status: 'SUCCESS' | 'FAILED';
  reason?: string;
}

export interface SettlementItem {
  productId: string;
  agentId: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  shippingFee?: number;
}

export interface SettlementCalculation {
  agentId: string;
  grossAmount: number;
  commissionRate: number;
  commissionAmount: number;
  netAmount: number;
}

export function calculateAgentSettlements(
  items: SettlementItem[],
  commissionRates: Map<string, number>,
): SettlementCalculation[] {
  const totalsByAgent = new Map<string, { products: number; shipping: number }>();
  for (const item of items) {
    const shippingFee = item.shippingFee ?? 0;
    const discountAmount = item.discountAmount ?? 0;
    if (!item.agentId || !Number.isFinite(item.unitPrice) || item.unitPrice < 0 || !Number.isInteger(item.quantity) || item.quantity <= 0
      || !Number.isInteger(shippingFee) || shippingFee < 0 || !Number.isInteger(discountAmount)
      || discountAmount < 0 || discountAmount > item.unitPrice * item.quantity) {
      throw new BadRequestError('Invalid order items for settlement');
    }
    const totals = totalsByAgent.get(item.agentId) ?? { products: 0, shipping: 0 };
    totals.products += item.unitPrice * item.quantity - discountAmount;
    totals.shipping += shippingFee;
    totalsByAgent.set(item.agentId, totals);
  }

  return [...totalsByAgent.entries()].map(([agentId, totals]) => {
    const commissionRate = commissionRates.get(agentId);
    if (commissionRate === undefined || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
      throw new BadRequestError(`Commission rate not found or invalid for agent: ${agentId}`);
    }
    // Shipping is seller revenue, but marketplace commission applies only to products.
    const grossAmount = totals.products + totals.shipping;
    const commissionAmount = Math.round(totals.products * commissionRate / 100);
    return { agentId, grossAmount, commissionRate, commissionAmount, netAmount: grossAmount - commissionAmount };
  });
}

export type PaymentGateway = (amount: number, method: string, orderId: string, idempotencyKey: string) => Promise<PGResponse>;
export type RefundGateway = (transactionId: string, amount: number, reason: string, idempotencyKey: string) => Promise<PGResponse>;

export async function callPaymentGateway(amount: number, method: string, orderId: string, idempotencyKey: string): Promise<PGResponse> {
  if (config.pg.mode === 'mock') {
    return { transactionId: `mock:${orderId}:${idempotencyKey}`, status: 'SUCCESS' };
  }
  const response = await fetch(config.pg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.pg.apiKey}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ amount, method, orderId }),
  });

  if (!response.ok) throw new Error(`Payment gateway HTTP ${response.status}`);
  return response.json() as Promise<PGResponse>;
}

export async function callRefundGateway(transactionId: string, amount: number, reason: string, idempotencyKey: string): Promise<PGResponse> {
  if (config.pg.mode === 'mock') {
    return { transactionId: `mock-refund:${transactionId}:${idempotencyKey}`, status: 'SUCCESS' };
  }
  const response = await fetch(config.pg.refundUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.pg.apiKey}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ transactionId, amount, reason }),
  });
  if (!response.ok) throw new Error(`Refund gateway HTTP ${response.status}`);
  return response.json() as Promise<PGResponse>;
}

export class ProcessPaymentUseCase {
  private readonly breaker: CircuitBreaker<[number, string, string, string], PGResponse>;
  private readonly refundBreaker: CircuitBreaker<[string, number, string, string], PGResponse>;

  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly kafkaProducer: KafkaProducer,
    private readonly redis: RedisClient,
    private readonly logger: Logger,
    gateway: PaymentGateway = callPaymentGateway,
    refundGateway: RefundGateway = callRefundGateway,
  ) {
    this.breaker = new CircuitBreaker(gateway, {
      timeout: 10000,      // 10s timeout
      errorThresholdPercentage: 50,
      resetTimeout: 30000, // 30s before half-open
      volumeThreshold: 5,
    });

    this.breaker.on('open', () => this.logger.warn('Payment gateway circuit OPEN'));
    this.breaker.on('halfOpen', () => this.logger.info('Payment gateway circuit HALF-OPEN'));
    this.breaker.on('close', () => this.logger.info('Payment gateway circuit CLOSED'));
    this.refundBreaker = new CircuitBreaker(refundGateway, {
      timeout: 10000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      volumeThreshold: 5,
    });
    this.refundBreaker.on('open', () => this.logger.warn('Refund gateway circuit OPEN'));
    this.refundBreaker.on('halfOpen', () => this.logger.info('Refund gateway circuit HALF-OPEN'));
    this.refundBreaker.on('close', () => this.logger.info('Refund gateway circuit CLOSED'));
  }

  async execute(input: InitiatePaymentInput): Promise<Payment> {
    let existing = await this.paymentRepo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      this.assertReplayMatches(existing, input);
      this.logger.info({ idempotencyKey: input.idempotencyKey }, 'Duplicate payment request, returning existing');
      return existing.status === PaymentStatus.PENDING ? this.processPending(existing) : this.republish(existing);
    }

    try {
      existing = await this.paymentRepo.create({
        id: uuidv4(),
        orderId: input.orderId,
        sagaId: input.sagaId,
        userId: input.userId,
        amount: input.amount,
        method: input.method,
        status: PaymentStatus.PENDING,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      existing = await this.paymentRepo.findByIdempotencyKey(input.idempotencyKey);
      if (!existing) {
        const orderPayment = await this.paymentRepo.findByOrderId(input.orderId);
        if (orderPayment) throw new ConflictError('A payment already exists for this order');
        throw error;
      }
      this.assertReplayMatches(existing, input);
      if (existing.status !== PaymentStatus.PENDING) return this.republish(existing);
    }
    return this.processPending(existing);
  }

  private async processPending(payment: Payment): Promise<Payment> {
    let response: PGResponse;
    try {
      response = await this.breaker.fire(payment.amount, payment.method, payment.orderId, payment.id);
    } catch (error) {
      // Preserve PENDING: the gateway may have accepted the charge before the
      // network failed. A retry uses the same gateway key and safely reconciles.
      this.logger.error({ error, paymentId: payment.id }, 'Payment gateway unavailable; payment remains pending');
      throw new ServiceUnavailableError('Payment gateway');
    }

    const status = response.status === 'SUCCESS' ? PaymentStatus.COMPLETED : PaymentStatus.FAILED;
    const finalized = await this.paymentRepo.finalizePending(payment.id, status, response.status === 'SUCCESS'
      ? { transactionId: response.transactionId }
      : { failureReason: response.reason ?? 'Payment declined' });
    const persisted = finalized ?? await this.paymentRepo.findById(payment.id);
    if (!persisted) throw new ConflictError('Payment disappeared during processing');
    await this.publishPaymentOutcome(persisted);
    return persisted;
  }

  private async republish(payment: Payment): Promise<Payment> {
    await this.publishPaymentOutcome(payment);
    return payment;
  }

  private assertReplayMatches(existing: Payment, input: InitiatePaymentInput): void {
    if (existing.orderId !== input.orderId || existing.sagaId !== input.sagaId || existing.userId !== input.userId
      || existing.amount !== input.amount || existing.method !== input.method) {
      throw new ConflictError('Idempotency key is already used for another payment');
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
  }

  async refund(paymentId: string, refundAmount: number, reason: string, referenceId: string, agentId?: string): Promise<void> {
    if (!referenceId || referenceId.length > 255) throw new BadRequestError('A valid refund reference is required');
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) throw new BadRequestError('Refund amount must be greater than zero');
    if (!reason?.trim()) throw new BadRequestError('Refund reason is required');

    const replay = await this.paymentRepo.findRefundByReference(referenceId);
    if (replay) {
      const payment = await this.paymentRepo.findById(paymentId);
      if (!payment || replay.paymentId !== paymentId || replay.amount !== refundAmount || replay.reason !== reason || replay.agentId !== agentId) {
        throw new ConflictError('Refund reference was already used with different details');
      }
      if (!replay.status || replay.status === 'COMPLETED') {
        const totalRefunded = await this.paymentRepo.sumRefunds(paymentId);
        await this.publishRefund(payment, replay, totalRefunded, payment.status);
        return;
      }
      if (replay.status === 'FAILED') throw new ConflictError(`Refund failed: ${replay.failureReason ?? 'gateway declined'}`);
      return this.processPendingRefund(payment, replay);
    }

    const outcome = await withTransaction(async (client) => {
      const payment = await this.paymentRepo.findByIdForUpdate(paymentId, client);
      if (!payment) throw new ConflictError('Payment not found');
      const existing = await this.paymentRepo.findRefundByReference(referenceId, client);
      if (existing) {
        if (existing.paymentId !== paymentId || existing.amount !== refundAmount || existing.reason !== reason || existing.agentId !== agentId) {
          throw new ConflictError('Refund reference was already used with different details');
        }
        return { payment, refund: existing };
      }
      if (![PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED].includes(payment.status)) {
        throw new ConflictError('Payment is not refundable');
      }
      const reserved = await this.paymentRepo.sumReservedRefunds(paymentId, client);
      if (reserved + refundAmount > payment.amount) throw new BadRequestError('Cumulative refund exceeds the payment amount');

      const refund = await this.paymentRepo.createRefund(
        { id: uuidv4(), paymentId, orderId: payment.orderId, referenceId, agentId, amount: refundAmount, reason },
        client,
      );
      return { payment, refund };
    });
    if (outcome.refund.status === 'FAILED') throw new ConflictError(`Refund failed: ${outcome.refund.failureReason ?? 'gateway declined'}`);
    if (outcome.refund.status === 'COMPLETED') {
      const totalRefunded = await this.paymentRepo.sumRefunds(paymentId);
      await this.publishRefund(outcome.payment, outcome.refund, totalRefunded, outcome.payment.status);
      return;
    }
    await this.processPendingRefund(outcome.payment, outcome.refund);
  }

  private async processPendingRefund(payment: Payment, refund: RefundRecord): Promise<void> {
    if (!payment.transactionId) throw new ConflictError('Refundable payment has no gateway transaction ID');
    let response: PGResponse;
    try {
      response = await this.refundBreaker.fire(payment.transactionId, refund.amount, refund.reason, refund.id);
    } catch (error) {
      this.logger.error({ error, refundId: refund.id }, 'Refund gateway unavailable; refund remains pending');
      throw new ServiceUnavailableError('Refund gateway');
    }

    if (response.status === 'FAILED') {
      await this.paymentRepo.finalizePendingRefund(refund.id, 'FAILED', { failureReason: response.reason ?? 'Refund declined' });
      throw new BadRequestError(response.reason ?? 'Refund declined');
    }

    const outcome = await withTransaction(async (client) => {
      const lockedPayment = await this.paymentRepo.findByIdForUpdate(payment.id, client);
      if (!lockedPayment) throw new ConflictError('Payment not found');
      const finalized = await this.paymentRepo.finalizePendingRefund(
        refund.id,
        'COMPLETED',
        { gatewayRefundId: response.transactionId },
        client,
      );
      const persisted = finalized ?? await this.paymentRepo.findRefundByReference(refund.referenceId, client);
      if (!persisted) throw new ConflictError('Refund disappeared during processing');
      if (persisted.status === 'FAILED') throw new ConflictError(`Refund failed: ${persisted.failureReason ?? 'gateway declined'}`);

      const totalRefunded = await this.paymentRepo.sumRefunds(payment.id, client);
      const status = totalRefunded === lockedPayment.amount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
      await this.paymentRepo.updateStatus(payment.id, status, { refundAmount: totalRefunded }, client);
      const settlements = await this.paymentRepo.findSettlementsByPayment(payment.id, client);
      const allocations = allocateRefundToSettlements(persisted.amount, settlements, persisted.agentId);
      for (const allocation of allocations.filter((item) => item.requiresClawback)) {
        await this.paymentRepo.createSettlementAdjustment({
          id: uuidv4(),
          settlementId: allocation.settlementId,
          refundId: persisted.id,
          agentId: allocation.agentId,
          orderId: lockedPayment.orderId,
          grossAmount: allocation.grossAmount,
          commissionReversal: allocation.commissionReversal,
          netAmount: allocation.netAmount,
        }, client);
      }
      if (persisted.agentId) await this.paymentRepo.cancelSettlementByPaymentAndAgent(payment.id, persisted.agentId, client);
      if (status === PaymentStatus.REFUNDED) await this.paymentRepo.cancelSettlementsByPayment(payment.id, client);
      return { payment: { ...lockedPayment, status }, refund: persisted, totalRefunded, status };
    });
    await this.publishRefund(outcome.payment, outcome.refund, outcome.totalRefunded, outcome.status);
  }

  private async publishRefund(payment: Payment, refund: { id: string; referenceId: string; agentId?: string; amount: number; reason: string }, totalRefunded: number, paymentStatus: PaymentStatus): Promise<void> {
    await this.kafkaProducer.send(
      KafkaTopic.PAYMENT_REFUNDED,
      {
        topic: KafkaTopic.PAYMENT_REFUNDED,
        payload: {
          paymentId: payment.id,
          refundId: refund.id,
          referenceId: refund.referenceId,
          agentId: refund.agentId,
          orderId: payment.orderId,
          refundAmount: refund.amount,
          totalRefunded,
          paymentStatus,
          reason: refund.reason,
        },
      },
      refund.referenceId,
    );
  }

  private async publishPaymentOutcome(payment: Payment): Promise<void> {
    if (payment.status === PaymentStatus.COMPLETED) {
      if (!payment.transactionId) throw new ConflictError('Completed payment has no transaction ID');
      await this.kafkaProducer.send(KafkaTopic.PAYMENT_COMPLETED, {
        topic: KafkaTopic.PAYMENT_COMPLETED,
        payload: {
          paymentId: payment.id,
          orderId: payment.orderId,
          userId: payment.userId,
          sagaId: payment.sagaId,
          amount: payment.amount,
          method: payment.method,
          transactionId: payment.transactionId,
        },
      }, payment.sagaId);
    } else if (payment.status === PaymentStatus.FAILED) {
      await this.kafkaProducer.send(KafkaTopic.PAYMENT_FAILED, {
        topic: KafkaTopic.PAYMENT_FAILED,
        payload: {
          paymentId: payment.id,
          orderId: payment.orderId,
          userId: payment.userId,
          sagaId: payment.sagaId,
          reason: payment.failureReason ?? 'Payment failed',
        },
      }, payment.sagaId);
    }
  }

  async createAgentSettlements(
    orderId: string,
    paymentId: string,
    items: SettlementItem[],
    commissionRates: Map<string, number>,
  ): Promise<void> {
    const settlements = calculateAgentSettlements(items, commissionRates).map((calculation) => {
      return {
        id: uuidv4(),
        paymentId,
        orderId,
        ...calculation,
        status: 'PENDING' as const,
      };
    });

    const persisted = await withTransaction(async (client) => {
      const rows = [];
      for (const settlement of settlements) {
        rows.push(await this.paymentRepo.createSettlement(settlement, client));
      }
      return rows;
    });

    // Emit after the settlement transaction commits. Replayed ORDER_PAID events
    // may re-emit these deterministic facts; consumers must use orderId+agentId
    // as their idempotency key, matching the database uniqueness constraint.
    for (const settlement of persisted) {
      await this.kafkaProducer.send(
        KafkaTopic.AGENT_SETTLEMENT_CREATED,
        { topic: KafkaTopic.AGENT_SETTLEMENT_CREATED, payload: {
          settlementId: settlement.id,
          paymentId,
          orderId,
          agentId: settlement.agentId,
          grossAmount: settlement.grossAmount,
          commissionRate: settlement.commissionRate,
          commissionAmount: settlement.commissionAmount,
          netAmount: settlement.netAmount,
        } },
        `${orderId}:${settlement.agentId}`,
      );
    }
  }
}
