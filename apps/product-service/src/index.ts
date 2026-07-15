import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaProducer } from '@ecommerce/kafka-client';
import { config } from './config';
import { pool } from './infrastructure/db/pg-pool';
import { connectMongo, closeMongo } from './infrastructure/db/mongo-client';
import { ProductWriteRepository } from './domain/repositories/product-write.repository';
import { ProductReadRepository } from './domain/repositories/product-read.repository';
import { ProductUseCases } from './application/use-cases/product.use-cases';
import { ProductController } from './infrastructure/http/controllers/product.controller';
import { createProductRouter } from './infrastructure/http/routes/product.routes';
import { createErrorHandler } from './infrastructure/http/middleware/error-handler';
import { errorResponse, successResponse } from '@ecommerce/shared';

const logger = createLogger({ service: 'product-service', level: config.logLevel });

async function bootstrap(): Promise<void> {
  const mongoClient = await connectMongo();

  const redis = createRedisClient({ host: config.redis.host, port: config.redis.port }, logger);
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  const writeRepo = new ProductWriteRepository();
  const readRepo = new ProductReadRepository(redis);
  const useCases = new ProductUseCases(writeRepo, readRepo, kafkaProducer);
  const controller = new ProductController(useCases);

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  const observability = createHttpObservability('product-service', logger);
  app.use(observability.middleware);

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'product-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'postgres', check: () => pool.query('SELECT 1') },
    { name: 'redis', check: () => redis.ping() },
    { name: 'mongodb', check: () => mongoClient.db(config.mongodb.dbName).command({ ping: 1 }) },
    { name: 'kafka-producer', check: async () => kafkaProducer.isReady() },
  ]));

  // Service-to-service source-of-truth lookup used while pricing an order.
  // It intentionally reads PostgreSQL rather than the eventually-consistent
  // MongoDB projection so clients cannot submit their own price or agent data.
  app.post('/internal/products/resolve', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const productIds: unknown[] = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
    if (productIds.length === 0 || productIds.length > 50 || productIds.some((id: unknown) => typeof id !== 'string')) {
      return res.status(400).json(errorResponse('VALIDATION_ERROR', 'productIds must contain 1 to 50 IDs'));
    }
    const ids = [...new Set(productIds as string[])];
    const products = await writeRepo.findActiveByIds(ids);
    return res.json(successResponse(products.map((product) => ({
      productId: product.id,
      catalogVariantId: product.catalogVariantId,
      agentId: product.agentId,
      sellerSku: product.sku,
      condition: product.condition,
      productName: product.name,
      productImage: product.images[0],
      unitPrice: product.price,
    }))));
  });
  app.get('/internal/products/:id/ownership', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const product = await writeRepo.findById(req.params.id);
    if (!product) return res.status(404).json(errorResponse('NOT_FOUND', 'Product not found'));
    return res.json(successResponse({
      productId: product.id, catalogVariantId: product.catalogVariantId,
      agentId: product.agentId, sellerSku: product.sku, condition: product.condition, status: product.status,
    }));
  });
  app.delete('/internal/products/:id', async (req, res, next) => {
    try {
      if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
        return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
      }
      await useCases.deleteAny(req.params.id);
      return res.json(successResponse({ message: 'Product deleted' }));
    } catch (error) {
      next(error);
    }
  });
  app.use('/api/products', createProductRouter(controller));
  app.use(createErrorHandler(logger));

  const server = app.listen(config.port, () => {
    logger.info(`product-service listening on port ${config.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received`);
    server.close(async () => {
      await kafkaProducer.disconnect();
      await pool.end();
      await closeMongo();
      redis.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => { logger.fatal({ err }, 'Uncaught exception'); process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });
}

bootstrap().catch((err) => { console.error('Failed to start product-service:', err); process.exit(1); });
