import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaProducer, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic, successResponse, errorResponse } from '@ecommerce/shared';
import { toHttpError } from '@ecommerce/errors';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { PaymentRepository } from './domain/repositories/payment.repository';
import { ProcessPaymentUseCase } from './application/use-cases/process-payment.use-case';
import { PaymentMethod } from './domain/entities/payment.entity';

const logger = createLogger({ service: 'payment-service', level: config.logLevel });

async function bootstrap(): Promise<void> {
  const redis = createRedisClient({ host: config.redis.host, port: config.redis.port }, logger);
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  const paymentRepo = new PaymentRepository();
  const processPayment = new ProcessPaymentUseCase(paymentRepo, kafkaProducer, redis, logger);

  // Kafka consumer: listen for ORDER_CONFIRMED (saga step 2)
  const consumer = new KafkaConsumer(
    kafka, { groupId: config.kafka.groupId, topics: [] }, logger,
  );
  await consumer.connect({ topics: [KafkaTopic.ORDER_CONFIRMED, KafkaTopic.RETURN_REQUESTED], fromBeginning: false });
  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    if (payload.topic === KafkaTopic.ORDER_CONFIRMED) {
      // Auto-process payment after order confirmed (real app: user initiates payment)
      logger.info({ orderId: event.payload.orderId }, 'Order confirmed, awaiting payment initiation');
    } else if (payload.topic === KafkaTopic.RETURN_REQUESTED) {
      // Issue refund
      await processPayment.refund(
        event.payload.paymentId ?? '', event.payload.refundAmount, event.payload.reason,
      );
    }
  });

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    if (userId && userRole) req.user = { id: userId, role: userRole };
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'payment-service' }));

  // Initiate payment (user action after order creation)
  app.post('/api/payments', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });
      const { orderId, sagaId, amount, method, idempotencyKey } = req.body;
      const payment = await processPayment.execute({
        orderId, sagaId, amount, method: method as PaymentMethod, idempotencyKey,
        userId: req.user.id,
      });
      res.status(201).json(successResponse(payment));
    } catch (err) { next(err); }
  });

  app.get('/api/payments/:paymentId', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });
      const payment = await paymentRepo.findById(req.params.paymentId);
      res.json(successResponse(payment));
    } catch (err) { next(err); }
  });

  app.post('/api/payments/:paymentId/refund', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });
      const { refundAmount, reason } = req.body;
      await processPayment.refund(req.params.paymentId, refundAmount, reason);
      res.json(successResponse({ message: 'Refund initiated' }));
    } catch (err) { next(err); }
  });

  // Agent settlements
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
