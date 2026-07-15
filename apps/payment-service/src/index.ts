import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaProducer, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic, successResponse, errorResponse } from '@ecommerce/shared';
import { toHttpError, ForbiddenError, NotFoundError } from '@ecommerce/errors';
import { Permission, requirePermission } from '@ecommerce/rbac';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { PaymentRepository } from './domain/repositories/payment.repository';
import { ProcessPaymentUseCase } from './application/use-cases/process-payment.use-case';
import { PaymentMethod } from './domain/entities/payment.entity';
import { CreatePaymentSchema, CreateRefundSchema } from './application/dtos/payment.dto';
import { SettlementManagementUseCase } from './application/settlement-management';

const logger = createLogger({ service: 'payment-service', level: config.logLevel });

interface PaymentContext {
  orderId: string;
  sagaId: string;
  userId: string;
  amount: number;
  status: string;
}

async function resolvePaymentContext(orderId: string): Promise<PaymentContext> {
  const response = await fetch(`${config.services.orderUrl}/internal/orders/${encodeURIComponent(orderId)}/payment-context`, {
    headers: { 'x-internal-service-token': config.internalServiceToken },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) throw new NotFoundError('Order', orderId);
  if (!response.ok) throw new ForbiddenError('Order is not payable');
  const body = await response.json() as { data: PaymentContext };
  return body.data;
}

async function resolveCommissionRates(agentIds: string[]): Promise<Map<string, number>> {
  const response = await fetch(`${config.services.authUrl}/internal/agents/commission-rates`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-service-token': config.internalServiceToken,
    },
    body: JSON.stringify({ agentIds }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new ForbiddenError('Unable to resolve agent commission rates');
  const body = await response.json() as { data?: Record<string, number> };
  return new Map(Object.entries(body.data ?? {}).map(([id, rate]) => [id, Number(rate)]));
}

async function bootstrap(): Promise<void> {
  const redis = createRedisClient({ host: config.redis.host, port: config.redis.port }, logger);
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  const paymentRepo = new PaymentRepository();
  const processPayment = new ProcessPaymentUseCase(paymentRepo, kafkaProducer, redis, logger);
  const settlementManagement = new SettlementManagementUseCase(paymentRepo, kafkaProducer);

  // Kafka consumer: listen for ORDER_CONFIRMED (saga step 2)
  const consumer = new KafkaConsumer(
    kafka,
    { groupId: config.kafka.groupId, topics: [], dlqTopic: 'payment.events.dlq', maxRetries: 3 },
    logger,
  );
  await consumer.connect({ topics: [KafkaTopic.ORDER_CONFIRMED, KafkaTopic.ORDER_PAID, KafkaTopic.RETURN_REQUESTED], fromBeginning: false });
  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    if (payload.topic === KafkaTopic.ORDER_CONFIRMED) {
      // Auto-process payment after order confirmed (real app: user initiates payment)
      logger.info({ orderId: event.payload.orderId }, 'Order confirmed, awaiting payment initiation');
    } else if (payload.topic === KafkaTopic.ORDER_PAID) {
      const items = event.payload.items ?? [];
      const rates = await resolveCommissionRates([...new Set(items.map((item: any) => item.agentId))] as string[]);
      await processPayment.createAgentSettlements(
        event.payload.orderId,
        event.payload.paymentId,
        items,
        rates,
      );
    } else if (payload.topic === KafkaTopic.RETURN_REQUESTED) {
      // Issue refund
      const payment = event.payload.paymentId
        ? await paymentRepo.findById(event.payload.paymentId)
        : await paymentRepo.findByOrderId(event.payload.orderId);
      if (!payment) throw new NotFoundError('Payment for order', event.payload.orderId);
      await processPayment.refund(
        payment.id, event.payload.refundAmount, event.payload.reason, event.payload.returnRequestId, event.payload.agentId,
      );
    }
  });

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  const observability = createHttpObservability('payment-service', logger);
  app.use(observability.middleware);

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const agentId = req.headers['x-agent-id'];
    if (userId && userRole) req.user = { id: userId, role: userRole, agentId };
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'payment-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'postgres', check: () => pool.query('SELECT 1') },
    { name: 'redis', check: () => redis.ping() },
    { name: 'kafka-producer', check: async () => kafkaProducer.isReady() },
    { name: 'kafka-consumer', check: async () => consumer.isReady() },
  ]));

  app.patch('/internal/settlements/:settlementId/status', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    try {
      const result = await settlementManagement.updateSettlement(String(req.params.settlementId), String(req.body?.status ?? ''));
      return res.json(successResponse(result));
    } catch (error) {
      const mapped = toHttpError(error);
      return res.status(mapped.statusCode).json(errorResponse(mapped.code, mapped.message, mapped.details));
    }
  });

  app.patch('/internal/settlement-adjustments/:adjustmentId/status', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    try {
      const result = await settlementManagement.updateAdjustment(String(req.params.adjustmentId), String(req.body?.status ?? ''));
      return res.json(successResponse(result));
    } catch (error) {
      const mapped = toHttpError(error);
      return res.status(mapped.statusCode).json(errorResponse(mapped.code, mapped.message, mapped.details));
    }
  });

  // Initiate payment (user action after order creation)
  app.post('/api/payments', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });
      const parsed = CreatePaymentSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid payment request', parsed.error.errors));
      const { orderId, method, idempotencyKey } = parsed.data;
      const replay = await paymentRepo.findByIdempotencyKey(idempotencyKey);
      if (replay) {
        if (replay.userId !== req.user.id || replay.orderId !== orderId || replay.method !== method) {
          throw new ForbiddenError('Payment idempotency key does not match this request');
        }
        const payment = await processPayment.execute({
          orderId: replay.orderId,
          sagaId: replay.sagaId,
          amount: replay.amount,
          method: replay.method,
          idempotencyKey,
          userId: replay.userId,
        });
        return res.status(200).json(successResponse(payment));
      }
      const context = await resolvePaymentContext(orderId);
      if (context.userId !== req.user.id) throw new ForbiddenError('You do not own this order');
      const payment = await processPayment.execute({
        orderId: context.orderId,
        sagaId: context.sagaId,
        amount: context.amount,
        method: method as PaymentMethod,
        idempotencyKey,
        userId: context.userId,
      });
      res.status(201).json(successResponse(payment));
    } catch (err) { next(err); }
  });

  // Agent settlements — registered before /:paymentId so "settlements" isn't swallowed as a param
  app.get('/api/payments/settlements', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user?.agentId) return res.status(403).json({ success: false });
      const page = parseInt(req.query.page as string || '1', 10);
      const limit = parseInt(req.query.limit as string || '20', 10);
      const offset = (page - 1) * limit;
      const result = await paymentRepo.findSettlementsByAgent(req.user.agentId, limit, offset);
      res.json(successResponse(result));
    } catch (err) { next(err); }
  });

  app.get('/api/payments/:paymentId', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });
      const payment = await paymentRepo.findById(req.params.paymentId);
      if (!payment) throw new NotFoundError('Payment', req.params.paymentId);
      const isOwner = payment.userId === req.user.id;
      const isAdmin = req.user.role === 'admin' || req.user.role === 'super-admin';
      if (!isOwner && !isAdmin) throw new ForbiddenError('You do not own this payment');
      res.json(successResponse(payment));
    } catch (err) { next(err); }
  });

  app.post(
    '/api/payments/:paymentId/refund',
    extractUser,
    requirePermission(Permission.ISSUE_REFUND),
    async (req: any, res: any, next: any) => {
      try {
        const parsed = CreateRefundSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid refund request', parsed.error.errors));
        const { refundAmount, reason, idempotencyKey } = parsed.data;
        await processPayment.refund(req.params.paymentId, refundAmount, reason, `manual:${idempotencyKey}`);
        res.json(successResponse({ message: 'Refund initiated' }));
      } catch (err) { next(err); }
    },
  );

  app.use((err: unknown, _req: any, res: any, _next: any) => {
    const { statusCode, code, message, details } = toHttpError(err);
    res.status(statusCode).json(errorResponse(code, message, details));
  });

  const server = app.listen(config.port, () => {
    logger.info(`payment-service listening on port ${config.port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
    server.close(async () => {
      await consumer.disconnect();
      await kafkaProducer.disconnect();
      await pool.end();
      redis.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => { logger.fatal({ err }, 'Uncaught exception'); process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });
}

bootstrap().catch((err) => { console.error('Failed to start payment-service:', err); process.exit(1); });
