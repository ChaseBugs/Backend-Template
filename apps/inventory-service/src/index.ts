import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Counter, createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaProducer, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic } from '@ecommerce/shared';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { InventoryRepository } from './domain/repositories/inventory.repository';
import { InventoryUseCases } from './application/use-cases/inventory.use-cases';
import { NotFoundError, ServiceUnavailableError, toHttpError } from '@ecommerce/errors';
import { errorResponse, successResponse } from '@ecommerce/shared';
import { z } from 'zod';

const logger = createLogger({ service: 'inventory-service', level: config.logLevel });

const SetStockSchema = z.object({ quantity: z.number().int().min(0) });
const AdjustStockSchema = z.object({
  delta: z.number().int().refine((value) => value !== 0, 'delta cannot be zero'),
  note: z.string().trim().max(500).optional(),
});

async function resolveProductOwner(productId: string): Promise<string> {
  const response = await fetch(`${config.services.productUrl}/internal/products/${encodeURIComponent(productId)}/ownership`, {
    headers: { 'x-internal-service-token': config.internalServiceToken },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) throw new NotFoundError('Product', productId);
  if (!response.ok) throw new ServiceUnavailableError('Product service');
  const body = await response.json() as { data?: { agentId: string } };
  if (!body.data?.agentId) throw new ServiceUnavailableError('Product service');
  return body.data.agentId;
}

async function bootstrap(): Promise<void> {
  const observability = createHttpObservability('inventory-service', logger);
  const reservationAttempts = new Counter({
    name: 'inventory_service_reservation_attempts_total',
    help: 'Inventory reservation outcomes used to calculate the deduction failure rate',
    labelNames: ['result'],
    registers: [observability.registry],
  });
  const cacheLookups = new Counter({
    name: 'inventory_service_cache_lookups_total',
    help: 'Inventory stock cache lookups used to calculate cache hit rate',
    labelNames: ['result'],
    registers: [observability.registry],
  });
  const redis = createRedisClient({ host: config.redis.host, port: config.redis.port }, logger);
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  const repo = new InventoryRepository();
  const useCases = new InventoryUseCases(repo, redis, kafkaProducer, logger, undefined, {
    recordReservation: (result) => reservationAttempts.inc({ result }),
    recordCacheLookup: (result) => cacheLookups.inc({ result }),
  });

  // Kafka consumer for SAGA events
  const consumer = new KafkaConsumer(
    kafka,
    {
      groupId: config.kafka.groupId,
      topics: [KafkaTopic.ORDER_CREATED, KafkaTopic.ORDER_PAID, KafkaTopic.ORDER_CANCELLED],
      dlqTopic: 'inventory.events.dlq',
      maxRetries: 3,
    },
    logger,
  );

  await consumer.connect({
    topics: [KafkaTopic.ORDER_CREATED, KafkaTopic.ORDER_PAID, KafkaTopic.ORDER_CANCELLED],
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
    } else if (topic === KafkaTopic.ORDER_PAID) {
      await useCases.confirmDeduction(event.payload.orderId, event.payload.items);
    } else if (topic === KafkaTopic.ORDER_CANCELLED) {
      await useCases.releaseItems(event.payload.orderId, event.payload.sagaId ?? '', event.payload.items ?? []);
    }
  });

  // HTTP API
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(observability.middleware);

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const agentId = req.headers['x-agent-id'];
    if (userId && userRole) req.user = { id: userId, role: userRole, agentId };
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'inventory-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'postgres', check: () => pool.query('SELECT 1') },
    { name: 'redis', check: () => redis.ping() },
    { name: 'kafka-producer', check: async () => kafkaProducer.isReady() },
    { name: 'kafka-consumer', check: async () => consumer.isReady() },
  ]));

  app.get('/api/inventory/:productId', async (req, res, next) => {
    try {
      const stock = await useCases.getStock(req.params.productId);
      res.json(successResponse(stock));
    } catch (err) { next(err); }
  });

  app.put('/api/inventory/:productId', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json(errorResponse('UNAUTHORIZED', 'Authentication required'));
      const isAdmin = req.user.role === 'admin' || req.user.role === 'super-admin';
      if (!req.user.agentId && !isAdmin) return res.status(403).json(errorResponse('FORBIDDEN', 'Agent access required'));
      const parsed = SetStockSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid stock quantity', parsed.error.errors));
      const ownerAgentId = await resolveProductOwner(req.params.productId);
      if (!isAdmin && ownerAgentId !== req.user.agentId) return res.status(403).json(errorResponse('FORBIDDEN', 'You do not own this product'));
      await useCases.setStock(req.params.productId, ownerAgentId, parsed.data.quantity);
      res.json(successResponse({ message: 'Stock updated' }));
    } catch (err) { next(err); }
  });

  app.patch('/api/inventory/:productId/adjust', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json(errorResponse('UNAUTHORIZED', 'Authentication required'));
      const isAdmin = req.user.role === 'admin' || req.user.role === 'super-admin';
      if (!req.user.agentId && !isAdmin) return res.status(403).json(errorResponse('FORBIDDEN', 'Agent access required'));
      const parsed = AdjustStockSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid stock adjustment', parsed.error.errors));
      const ownerAgentId = await resolveProductOwner(req.params.productId);
      if (!isAdmin && ownerAgentId !== req.user.agentId) return res.status(403).json(errorResponse('FORBIDDEN', 'You do not own this product'));
      await useCases.adjustStock(req.params.productId, parsed.data.delta, ownerAgentId, parsed.data.note);
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
