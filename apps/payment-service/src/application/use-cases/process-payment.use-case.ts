import CircuitBreaker from 'opossum';
import { v4 as uuidv4 } from 'uuid';
import { PaymentRepository } from '../../domain/repositories/payment.repository';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { RedisClient } from '@ecommerce/redis-client';
import { KafkaTopic, PaymentStatus } from '@ecommerce/shared';
import { ConflictError, ServiceUnavailableError } from '@ecommerce/errors';
import { withTransaction } from '../../infrastructure/db/pool';
import { Payment, PaymentMethod } from '../../domain/entities/payment.entity';
import { config } from '../../config';
import { Logger } from '@ecommerce/logger';

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

async function callPaymentGateway(amount: number, method: string, orderId: string): Promise<PGResponse> {
  // Real implementation would use fetch/axios to call payment gateway
  // This is a mock implementation for the template
  const response = await fetch(config.pg.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.pg.apiKey}`,
    },
    body: JSON.stringify({ amount, method, orderId }),
  });

  if (!response.ok) throw new Error(`Payment gateway HTTP ${response.status}`);
  return response.json() as Promise<PGResponse>;
}

export class ProcessPaymentUseCase {
  private readonly breaker: CircuitBreaker<[number, string, string], PGResponse>;

  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly kafkaProducer: KafkaProducer,
    private readonly redis: RedisClient,
    private readonly logger: Logger,
  ) {
    this.breaker = new CircuitBreaker(callPaymentGateway, {
      timeout: 10000,      // 10s timeout
      errorThresholdPercentage: 50,
      resetTimeout: 30000, // 30s before half-open
      volumeThreshold: 5,
    });

    this.breaker.on('open', () => this.logger.warn('Payment gateway circuit OPEN'));
    this.breaker.on('halfOpen', () => this.logger.info('Payment gateway circuit HALF-OPEN'));
    this.breaker.on('close', () => this.logger.info('Payment gateway circuit CLOSED'));
  }

  async execute(input: InitiatePaymentInput): Promise<Payment> {
    // Idempotency check
    const existing = await this.paymentRepo.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      this.logger.info({ idempotencyKey: input.idempotencyKey }, 'Duplicate payment request, returning existing');
      return existing;
    }

    return withTransaction(async (client) => {
      const payment = await this.paymentRepo.create(
        {
          id: uuidv4(),
          orderId: input.orderId,
          sagaId: input.sagaId,
          userId: input.userId,
          amount: input.amount,
          method: input.method,
          status: PaymentStatus.PENDING,
          idempotencyKey: input.idempotencyKey,
        },
        client,
      );

      let pgResponse: PGResponse;
      try {
        pgResponse = await this.breaker.fire(input.amount, input.method, input.orderId);
      } catch (err) {
        // Circuit open or timeout
        await this.paymentRepo.updateStatus(payment.id, PaymentStatus.FAILED, { failureReason: 'Payment gateway unavailable' }, client);
        await this.kafkaProducer.send(
          KafkaTopic.PAYMENT_FAILED,
          {
            topic: KafkaTopic.PAYMENT_FAILED,
            payload: { paymentId: payment.id, orderId: input.orderId, sagaId: input.sagaId, reason: 'Payment gateway unavailable' },
          },
          input.sagaId,
        );
        throw new ServiceUnavailableError('Payment gateway');
      }

      if (pgResponse.status === 'SUCCESS') {
        await this.paymentRepo.updateStatus(payment.id, PaymentStatus.COMPLETED, { transactionId: pgResponse.transactionId }, client);
        await this.kafkaProducer.send(
          KafkaTopic.PAYMENT_COMPLETED,
          {
            topic: KafkaTopic.PAYMENT_COMPLETED,
            payload: {
              paymentId: payment.id,
              orderId: input.orderId,
              sagaId: input.sagaId,
              amount: input.amount,
              method: input.method,
              transactionId: pgResponse.transactionId,
            },
          },
          input.sagaId,
        );
      } else {
        await this.paymentRepo.updateStatus(payment.id, PaymentStatus.FAILED, { failureReason: pgResponse.reason }, client);
        await this.kafkaProducer.send(
          KafkaTopic.PAYMENT_FAILED,
          {
            topic: KafkaTopic.PAYMENT_FAILED,
            payload: { paymentId: payment.id, orderId: input.orderId, sagaId: input.sagaId, reason: pgResponse.reason ?? 'Payment declined' },
          },
          input.sagaId,
        );
      }

      return payment;
    });
  }

  async refund(paymentId: string, refundAmount: number, reason: string): Promise<void> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) throw new ConflictError('Payment not found');
    if (payment.status !== PaymentStatus.COMPLETED) throw new ConflictError('Payment not in completed state');

    await this.paymentRepo.updateStatus(paymentId, PaymentStatus.REFUNDED, { refundAmount });
    await this.kafkaProducer.send(
      KafkaTopic.PAYMENT_REFUNDED,
      {
        topic: KafkaTopic.PAYMENT_REFUNDED,
        payload: { paymentId, orderId: payment.orderId, refundAmount, reason },
      },
      payment.orderId,
    );
  }
}
