import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { createLogger } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic, successResponse, errorResponse } from '@ecommerce/shared';
import { toHttpError } from '@ecommerce/errors';
import { createHash } from 'crypto';

const logger = createLogger({ service: 'search-service', level: process.env.LOG_LEVEL ?? 'info' });

const OPENSEARCH_INDEX = 'products';
const CACHE_TTL = 5 * 60; // 5 min

async function bootstrap(): Promise<void> {
  const opensearch = new OpenSearchClient({
    node: process.env.OPENSEARCH_URL ?? 'http://localhost:9200',
  });

  const redis = createRedisClient({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  }, logger);

  const kafka = createKafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? 'search-service',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });

  // Kafka consumer: sync product events to OpenSearch
  const consumer = new KafkaConsumer(kafka, { groupId: 'search-service-group', topics: [] }, logger);
  await consumer.connect({
    topics: [KafkaTopic.PRODUCT_CREATED, KafkaTopic.PRODUCT_UPDATED, KafkaTopic.PRODUCT_DELETED, KafkaTopic.PRODUCT_APPROVED],
    fromBeginning: false,
  });

  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    if (payload.topic === KafkaTopic.PRODUCT_APPROVED || payload.topic === KafkaTopic.PRODUCT_CREATED) {
      await opensearch.index({
        index: OPENSEARCH_INDEX,
        id: event.payload.productId,
        body: {
          productId: event.payload.productId,
          agentId: event.payload.agentId,
          name: event.payload.name,
          price: event.payload.price,
          categoryId: event.payload.categoryId,
          brand: event.payload.brand,
          tags: event.payload.tags,
          inStock: (event.payload.initialStock ?? 0) > 0,
          status: 'ACTIVE',
        },
      });
    } else if (payload.topic === KafkaTopic.PRODUCT_UPDATED) {
      await opensearch.update({
        index: OPENSEARCH_INDEX,
        id: event.payload.productId,
        body: { doc: event.payload.changes },
      });
      // Invalidate search cache for this product
      await (redis as any).del(`product:${event.payload.productId}`);
    } else if (payload.topic === KafkaTopic.PRODUCT_DELETED) {
      await opensearch.delete({ index: OPENSEARCH_INDEX, id: event.payload.productId });
    }
  });

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'search-service' }));

  app.get('/api/search', async (req: any, res: any, next: any) => {
    try {
      const { q, categoryId, minPrice, maxPrice, page = 1, limit = 20 } = req.query;

      const queryHash = createHash('md5').update(JSON.stringify(req.query)).digest('hex');
      const cacheKey = `search:${queryHash}`;
      const cached = await (redis as any).get(cacheKey);
      if (cached) return res.json(successResponse(JSON.parse(cached)));

      const from = (parseInt(page, 10) - 1) * parseInt(limit, 10);

      const query: Record<string, unknown> = {
        bool: {
          must: q ? [{ multi_match: { query: q, fields: ['name^3', 'description', 'brand^2', 'tags'], analyzer: 'korean_analyzer' } }] : [{ match_all: {} }],
          filter: [
            { term: { status: 'ACTIVE' } },
            ...(categoryId ? [{ term: { categoryId } }] : []),
            ...(minPrice || maxPrice ? [{ range: { price: { ...(minPrice ? { gte: minPrice } : {}), ...(maxPrice ? { lte: maxPrice } : {}) } } }] : []),
          ],
        },
      };

      const response = await opensearch.search({
        index: OPENSEARCH_INDEX,
        body: { query, from, size: parseInt(limit, 10), track_total_hits: true },
      });

      const hits = response.body.hits;
      const result = {
        products: hits.hits.map((h: any) => ({ id: h._id, ...h._source, score: h._score })),
        total: typeof hits.total === 'object' ? hits.total.value : hits.total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
      };

      await (redis as any).setex(cacheKey, CACHE_TTL, JSON.stringify(result));

      // Track popular keyword
      if (q) await (redis as any).zincrby('search:popular', 1, q);

      res.json(successResponse(result));
    } catch (err) { next(err); }
  });

  app.get('/api/search/popular', async (_req, res, next) => {
    try {
      const keywords = await (redis as any).zrevrange('search:popular', 0, 9, 'WITHSCORES');
      const result: Array<{ keyword: string; count: number }> = [];
      for (let i = 0; i < keywords.length; i += 2) {
        result.push({ keyword: keywords[i], count: parseInt(keywords[i + 1], 10) });
      }
      res.json(successResponse(result));
    } catch (err) { next(err); }
  });

  app.use((err: unknown, _req: any, res: any, _next: any) => {
    const { statusCode, code, message, details } = toHttpError(err);
    res.status(statusCode).json(errorResponse(code, message, details));
  });

  const PORT = parseInt(process.env.PORT ?? '3006', 10);
  const server = app.listen(PORT, () => logger.info(`search-service listening on port ${PORT}`));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
    server.close(async () => {
      await consumer.disconnect();
      await opensearch.close();
      redis.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => { console.error('Failed to start search-service:', err); process.exit(1); });
