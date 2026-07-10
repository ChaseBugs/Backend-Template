import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createLogger } from '@ecommerce/logger';
import { config } from './config';
import { createRoutes } from './routes';

const logger = createLogger({ service: 'api-gateway', level: config.logLevel });

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));
app.use(express.json({ limit: '10mb' }));

// Global rate limiter
app.use(
  rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' } },
  }),
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});

app.use('/api/v1', createRoutes(logger));

app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

const server = app.listen(config.port, () => {
  logger.info(`api-gateway listening on port ${config.port}`);
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down api-gateway...`);
  server.close(() => {
    logger.info('api-gateway shut down cleanly');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => { logger.fatal({ err }, 'Uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });
