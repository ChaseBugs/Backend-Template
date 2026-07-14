import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaProducer, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic } from '@ecommerce/shared';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { InventoryRepository } from './domain/repositories/inventory.repository';
import { InventoryUseCases } from './application/use-cases/inventory.use-cases';
import { toHttpError } from '@ecommerce/errors';
import { errorResponse, successResponse } from '@ecommerce/shared';

const logger = createLogger({ service: 'inventory-service', level: config.logLevel });

async function bootstrap(): Promise<void> {
  const redis = createRedisClient({ host: config.redis.host, port: config.redis.port }, logger);
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  const repo = new InventoryRepository();
  const useCases = new InventoryUseCases(repo, redis, kafkaProducer, logger);

  // Kafka consumer for SAGA events
  const consumer = new KafkaConsumer(
    kafka,
    { groupId: config.kafka.groupId, topics: [KafkaTopic.ORDER_CREATED, KafkaTopic.PAYMENT_COMPLETED, KafkaTopic.PAYMENT_FAILED, KafkaTopic.ORDER_CANCELLED] },
    logger,
  );

  await consumer.connect({
    topics: [KafkaTopic.ORDER_CREATED, KafkaTopic.PAYMENT_COMPLETED, KafkaTopic.PAYMENT_FAILED, KafkaTopic.ORDER_CANCELLED],
    fromBeginning: false,
  });

  await consumer.run(async (payload) => {
    const topic = payload.topic;
    const event = consumer.parseMessage<any>(payload);

    if (topic === KafkaTopic.ORDER_CREATED) {
      await useCases.reserveItems({
        orderId: event.payload.orderId,
        sagaId: event.payload.sagaId,
        items: event.payload.items.map((i: any) => ({ productId: i.productId, quantity: i.quantity })),
      });
    } else if (topic === KafkaTopic.PAYMENT_COMPLETED) {
      await useCases.confirmDeduction(event.payload.orderId, event.payload.items ?? []);
    } else if (topic === KafkaTopic.PAYMENT_FAILED || topic === KafkaTopic.ORDER_CANCELLED) {
      await useCases.releaseItems(event.payload.orderId, event.payload.sagaId ?? '', event.payload.items ?? []);
    }
  });

  // HTTP API
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const agentId = req.headers['x-agent-id'];
    if (userId && userRole) req.user = { id: userId, role: userRole, agentId };
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'inventory-service' }));

  app.get('/api/inventory/:productId', async (req, res, next) => {
    try {
      const stock = await useCases.getStock(req.params.productId);
      res.json(successResponse(stock));
    } catch (err) { next(err); }
  });

  app.put('/api/inventory/:productId', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user?.agentId) return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Agent access required' } });
      const { quantity } = req.body;
      await useCases.setStock(req.params.productId, req.user.agentId, quantity);
      res.json(successResponse({ message: 'Stock updated' }));
    } catch (err) { next(err); }
  });

  app.patch('/api/inventory/:productId/adjust', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user?.agentId) return res.status(403).json({ success: false });
      const { delta, note } = req.body;
      await useCases.adjustStock(req.params.productId, delta, req.user.agentId, note);
      res.json(successResponse({ message: 'Stock adjusted' }));
    } catch (err) { next(err); }
  });

  app.use((err: unknown, _req: any, res: any, _next: any) => {
    const { statusCode, code, message, details } = toHttpError(err);
    res.status(statusCode).json(errorResponse(code, message, details));
  });

  const server = app.listen(config.port, () => {
    logger.info(`inventory-service listening on port ${config.port}`);
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

bootstrap().catch((err) => { console.error('Failed to start inventory-service:', err); process.exit(1); });
