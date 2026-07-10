import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@ecommerce/logger';
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

const logger = createLogger({ service: 'product-service', level: config.logLevel });

async function bootstrap(): Promise<void> {
  await connectMongo();

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

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'product-service' }));
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
