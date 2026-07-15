import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { z } from 'zod';
import { createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createKafka, KafkaProducer } from '@ecommerce/kafka-client';
import { KafkaTopic, successResponse, errorResponse } from '@ecommerce/shared';
import { ConflictError, ForbiddenError, NotFoundError, toHttpError } from '@ecommerce/errors';
import { drainRatingOutbox, queueRatingProjection, RatingProjection } from './rating-outbox';

const logger = createLogger({ service: 'review-service', level: process.env.LOG_LEVEL ?? 'info' });
const PORT = parseInt(process.env.PORT ?? '3011', 10);
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-internal-token';

const CreateReviewSchema = z.object({
  orderId: z.string().uuid(),
  productId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1).max(120),
  comment: z.string().trim().min(1).max(5000),
});
const UpdateReviewSchema = CreateReviewSchema.pick({ rating: true, title: true, comment: true }).partial().refine(
  (value) => Object.keys(value).length > 0,
  'At least one review field is required',
);

async function bootstrap(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://review_svc:review_pass@localhost:5432/ecommerce',
    max: 20,
  });
  pool.on('connect', (client) => client.query('SET search_path TO review, public'));
  await pool.query('SELECT 1');

  const kafka = createKafka({ clientId: 'review-service', brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',') });
  const producer = new KafkaProducer(kafka, logger);
  await producer.connect();

  const publishRating = async (projection: RatingProjection, eventId: string) => {
    await producer.send(KafkaTopic.REVIEW_RATING_UPDATED, {
      topic: KafkaTopic.REVIEW_RATING_UPDATED,
      payload: projection,
    }, projection.productId, eventId);
  };
  let draining = false;
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      let count: number;
      do {
        count = await drainRatingOutbox(pool, publishRating);
      } while (count > 0);
    } catch (error) {
      logger.error({ error }, 'Review rating outbox dispatch failed; retrying');
    } finally {
      draining = false;
    }
  };
  await drain();
  const outboxTimer = setInterval(() => void drain(), 1000);
  outboxTimer.unref();

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '32kb' }));
  const observability = createHttpObservability('review-service', logger);
  app.use(observability.middleware);
  app.use((req: any, _res, next) => {
    const id = req.headers['x-user-id'];
    const role = req.headers['x-user-role'];
    if (typeof id === 'string' && typeof role === 'string') req.user = { id, role };
    next();
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'review-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'postgres', check: () => pool.query('SELECT 1') },
    { name: 'kafka', check: async () => { if (!producer.isReady()) throw new Error('Kafka producer is not connected'); } },
  ]));

  app.get('/api/reviews/product/:productId', async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
      const [itemsResult, summaryResult] = await Promise.all([
        pool.query(
          `SELECT id, order_id AS "orderId", product_id AS "productId", user_id AS "userId",
                  rating, title, comment, created_at AS "createdAt", updated_at AS "updatedAt"
             FROM reviews WHERE product_id = $1
            ORDER BY created_at DESC, id DESC OFFSET $2 LIMIT $3`,
          [req.params.productId, (page - 1) * limit, limit],
        ),
        pool.query<{ average: string | null; count: string }>(
          'SELECT AVG(rating)::text AS average, COUNT(*)::text AS count FROM reviews WHERE product_id = $1',
          [req.params.productId],
        ),
      ]);
      const summary = summaryResult.rows[0];
      const total = Number(summary?.count ?? 0);
      const average = Number(summary?.average ?? 0);
      res.json(successResponse({ items: itemsResult.rows, total, page, limit, rating: { average: Math.round(average * 100) / 100, count: total } }));
    } catch (error) { next(error); }
  });

  app.post('/api/reviews', async (req: any, res, next) => {
    try {
      if (!req.user) return res.status(401).json(errorResponse('UNAUTHORIZED', 'Authentication required'));
      const parsed = CreateReviewSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid review', parsed.error.errors));
      const input = parsed.data;
      const eligibility = await fetch(`${ORDER_SERVICE_URL}/internal/orders/${input.orderId}/review-eligibility?userId=${encodeURIComponent(req.user.id)}&productId=${encodeURIComponent(input.productId)}`, {
        headers: { 'x-internal-service-token': INTERNAL_SERVICE_TOKEN }, signal: AbortSignal.timeout(5000),
      });
      const eligibilityBody = await eligibility.json() as { data?: { eligible: boolean } };
      if (!eligibility.ok || !eligibilityBody.data?.eligible) throw new ForbiddenError('A completed purchase is required to review this product');
      const now = new Date();
      const client = await pool.connect();
      let result;
      try {
        await client.query('BEGIN');
        result = await client.query<{ id: string }>(
          `INSERT INTO reviews (order_id, product_id, user_id, rating, title, comment, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
          [input.orderId, input.productId, req.user.id, input.rating, input.title, input.comment, now],
        );
        await queueRatingProjection(client, input.productId);
        await client.query('COMMIT');
      } catch (error: any) {
        await client.query('ROLLBACK');
        if (error?.code === '23505') throw new ConflictError('You have already reviewed this product');
        throw error;
      } finally {
        client.release();
      }
      void drain();
      res.status(201).json(successResponse({ id: result.rows[0].id, ...input, userId: req.user.id, createdAt: now }));
    } catch (error) { next(error); }
  });

  app.patch('/api/reviews/:id', async (req: any, res, next) => {
    try {
      if (!req.user) return res.status(401).json(errorResponse('UNAUTHORIZED', 'Authentication required'));
      if (!z.string().uuid().safeParse(req.params.id).success) throw new NotFoundError('Review', req.params.id);
      const parsed = UpdateReviewSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid review', parsed.error.errors));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existingResult = await client.query<{ id: string; userId: string; productId: string }>(
          'SELECT id, user_id AS "userId", product_id AS "productId" FROM reviews WHERE id = $1 FOR UPDATE', [req.params.id],
        );
        const existing = existingResult.rows[0];
        if (!existing) throw new NotFoundError('Review', req.params.id);
        if (existing.userId !== req.user.id) throw new ForbiddenError('You can only update your own review');
        const fields = Object.entries(parsed.data);
        const assignments = fields.map(([field], index) => `${field} = $${index + 2}`);
        await client.query(`UPDATE reviews SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = $1`, [existing.id, ...fields.map(([, value]) => value)]);
        await queueRatingProjection(client, existing.productId);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      void drain();
      res.json(successResponse({ message: 'Review updated' }));
    } catch (error) { next(error); }
  });

  app.delete('/api/reviews/:id', async (req: any, res, next) => {
    try {
      if (!req.user) return res.status(401).json(errorResponse('UNAUTHORIZED', 'Authentication required'));
      if (!z.string().uuid().safeParse(req.params.id).success) throw new NotFoundError('Review', req.params.id);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existingResult = await client.query<{ id: string; userId: string; productId: string }>(
          'SELECT id, user_id AS "userId", product_id AS "productId" FROM reviews WHERE id = $1 FOR UPDATE', [req.params.id],
        );
        const existing = existingResult.rows[0];
        if (!existing) throw new NotFoundError('Review', req.params.id);
        const isAdmin = req.user.role === 'admin' || req.user.role === 'super-admin';
        if (existing.userId !== req.user.id && !isAdmin) throw new ForbiddenError('You can only delete your own review');
        await client.query('DELETE FROM reviews WHERE id = $1', [existing.id]);
        await queueRatingProjection(client, existing.productId);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      void drain();
      res.json(successResponse({ message: 'Review deleted' }));
    } catch (error) { next(error); }
  });

  app.use((error: unknown, _req: any, res: any, _next: any) => {
    const { statusCode, code, message, details } = toHttpError(error);
    res.status(statusCode).json(errorResponse(code, message, details));
  });

  const server = app.listen(PORT, () => logger.info(`review-service listening on port ${PORT}`));
  const shutdown = () => {
    clearInterval(outboxTimer);
    server.close(async () => { await producer.disconnect(); await pool.end(); process.exit(0); });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((error) => { logger.fatal({ error }, 'Failed to start review-service'); process.exit(1); });
