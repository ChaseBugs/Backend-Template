import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createHttpObservability, createLogger } from '@ecommerce/logger';
import { config } from './config';
import { createRoutes } from './routes';
import { createRedisClient } from '@ecommerce/redis-client';
import { authenticate } from './middleware/authenticate';
import { RedisRateLimitStore } from './middleware/redis-rate-limit-store';
import { checkServiceReadiness } from './readiness';

const logger = createLogger({ service: 'api-gateway', level: config.logLevel });
const observability = createHttpObservability('api-gateway', logger);
const redis = createRedisClient(config.redis, logger);

const app = express();
app.set('trust proxy', config.trustProxyHops);

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(observability.middleware);
app.use(authenticate);

app.get('/metrics', async (_req, res) => {
  res.type(observability.registry.contentType).send(await observability.registry.metrics());
});

// Global rate limiter
app.use(
  rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: (req: any) => req.user?.role === 'super-admin' || req.user?.role === 'admin'
      ? 600
      : req.user?.role === 'agent' ? 400 : req.user?.role === 'user' ? 300 : 150,
    store: new RedisRateLimitStore(redis),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' } },
  }),
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});

app.get('/ready', async (_req, res) => {
  const checks = await checkServiceReadiness(config.services);
  try {
    await redis.ping();
    checks.push(['redis', 'up']);
  } catch {
    checks.push(['redis', 'down']);
  }
  const dependencies = Object.fromEntries(checks);
  const ready = checks.every(([, status]) => status === 'up');
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready', dependencies });
});

app.use('/api/v1', createRoutes(logger));

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

const server = app.listen(config.port, () => {
  logger.info(`api-gateway listening on port ${config.port}`);
  process.send?.('ready');
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down api-gateway...`);
  server.close(() => {
    redis.disconnect();
    logger.info('api-gateway shut down cleanly');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => { logger.fatal({ err }, 'Uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });
