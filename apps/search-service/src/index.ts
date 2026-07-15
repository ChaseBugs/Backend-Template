import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic, successResponse, errorResponse } from '@ecommerce/shared';
import { toHttpError } from '@ecommerce/errors';
import { createHash } from 'crypto';
import { z } from 'zod';
import { decodeSearchCursor, encodeSearchCursor, escapeRedisGlob } from './search-cursor';

const logger = createLogger({ service: 'search-service', level: process.env.LOG_LEVEL ?? 'info' });

const OPENSEARCH_INDEX = process.env.OPENSEARCH_INDEX_PRODUCTS ?? 'products';
const CACHE_TTL = parseInt(process.env.SEARCH_CACHE_TTL_SECONDS ?? '300', 10);

const SearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  brand: z.string().trim().min(1).max(100).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  inStock: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(2000).optional(),
});

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
  const consumer = new KafkaConsumer(kafka, {
    groupId: process.env.KAFKA_GROUP_ID ?? 'search-service-group',
    topics: [],
    dlqTopic: 'product.events.dlq',
    maxRetries: 3,
  }, logger);
  await consumer.connect({
    topics: [KafkaTopic.PRODUCT_UPDATED, KafkaTopic.PRODUCT_DELETED, KafkaTopic.PRODUCT_APPROVED,
      KafkaTopic.PRODUCT_REJECTED, KafkaTopic.INVENTORY_UPDATED, KafkaTopic.INVENTORY_DEDUCTED,
      KafkaTopic.REVIEW_RATING_UPDATED],
    fromBeginning: false,
  });

  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    if (payload.topic === KafkaTopic.PRODUCT_APPROVED) {
      const available = Number(await redis.get(`inventory:available:${event.payload.productId}`) ?? 0);
      const ratingAverage = Number(await redis.get(`review:rating:${event.payload.productId}:average`) ?? 0);
      const ratingCount = Number(await redis.get(`review:rating:${event.payload.productId}:count`) ?? 0);
      await opensearch.index({
        index: OPENSEARCH_INDEX,
        id: event.payload.productId,
        body: {
          productId: event.payload.productId,
          catalogVariantId: event.payload.catalogVariantId,
          agentId: event.payload.agentId,
          sku: event.payload.sku,
          condition: event.payload.condition,
          name: event.payload.name,
          description: event.payload.description,
          price: event.payload.price,
          comparePrice: event.payload.comparePrice,
          categoryId: event.payload.categoryId,
          brand: event.payload.brand,
          tags: event.payload.tags,
          imageUrl: event.payload.images?.[0],
          inStock: available > 0,
          ratingAverage,
          ratingCount,
          status: 'ACTIVE',
        },
        refresh: true,
      });
    } else if (payload.topic === KafkaTopic.PRODUCT_UPDATED) {
      // Every product edit requires reapproval, so remove the old public
      // document instead of exposing unapproved changes.
      await opensearch.delete({ index: OPENSEARCH_INDEX, id: event.payload.productId, refresh: true }, { ignore: [404] });
    } else if (payload.topic === KafkaTopic.PRODUCT_DELETED || payload.topic === KafkaTopic.PRODUCT_REJECTED) {
      await opensearch.delete({ index: OPENSEARCH_INDEX, id: event.payload.productId, refresh: true }, { ignore: [404] });
    } else if (payload.topic === KafkaTopic.INVENTORY_UPDATED) {
      await redis.set(`inventory:available:${event.payload.productId}`, event.payload.available);
      await opensearch.update({
        index: OPENSEARCH_INDEX, id: event.payload.productId,
        body: { doc: { inStock: event.payload.available > 0 } },
      }, { ignore: [404] });
    } else if (payload.topic === KafkaTopic.INVENTORY_DEDUCTED) {
      for (const item of event.payload.items ?? []) {
        await redis.set(`inventory:available:${item.productId}`, item.available);
        await opensearch.update({ index: OPENSEARCH_INDEX, id: item.productId, body: { doc: { inStock: item.available > 0 } } }, { ignore: [404] });
      }
    } else if (payload.topic === KafkaTopic.REVIEW_RATING_UPDATED) {
      await redis.set(`review:rating:${event.payload.productId}:average`, event.payload.average);
      await redis.set(`review:rating:${event.payload.productId}:count`, event.payload.count);
      await opensearch.update({
        index: OPENSEARCH_INDEX,
        id: event.payload.productId,
        body: { doc: { ratingAverage: event.payload.average, ratingCount: event.payload.count } },
      }, { ignore: [404] });
    }
    await redis.incr('search:cache-version');
  });

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  const observability = createHttpObservability('search-service', logger);
  app.use(observability.middleware);

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'search-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'opensearch', check: () => opensearch.ping() },
    { name: 'redis', check: () => redis.ping() },
    { name: 'kafka-consumer', check: async () => consumer.isReady() },
  ]));

  app.get('/api/search', async (req: any, res: any, next: any) => {
    try {
      const parsed = SearchQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid search query', parsed.error.errors));
      const { q, categoryId, agentId, brand, minPrice, maxPrice, minRating, inStock, page, limit, cursor } = parsed.data;
      let searchAfter: unknown[] | undefined;
      try { searchAfter = decodeSearchCursor(cursor); } catch {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid search cursor'));
      }

      const cacheVersion = await redis.get('search:cache-version') ?? '0';
      const queryHash = createHash('md5').update(JSON.stringify({ ...parsed.data, cacheVersion })).digest('hex');
      const cacheKey = `search:${queryHash}`;
      const cached = await (redis as any).get(cacheKey);
      if (cached) return res.json(successResponse(JSON.parse(cached)));

      const from = cursor ? undefined : (page - 1) * limit;

      const query: Record<string, unknown> = {
        bool: {
          must: q ? [{ multi_match: { query: q, fields: ['name^3', 'description', 'brand^2', 'tags'], analyzer: 'korean_analyzer', fuzziness: 'AUTO', type: 'best_fields' } }] : [{ match_all: {} }],
          filter: [
            { term: { status: 'ACTIVE' } },
            ...(categoryId ? [{ term: { categoryId } }] : []),
            ...(agentId ? [{ term: { agentId } }] : []),
            ...(brand ? [{ term: { brand } }] : []),
            ...(minPrice !== undefined || maxPrice !== undefined ? [{ range: { price: { ...(minPrice !== undefined ? { gte: minPrice } : {}), ...(maxPrice !== undefined ? { lte: maxPrice } : {}) } } }] : []),
            ...(minRating !== undefined ? [{ range: { ratingAverage: { gte: minRating } } }] : []),
            ...(inStock ? [{ term: { inStock: inStock === 'true' } }] : []),
          ],
        },
      };

      const response = await opensearch.search({
        index: OPENSEARCH_INDEX,
        body: {
          query,
          ...(from !== undefined ? { from } : {}),
          ...(searchAfter ? { search_after: searchAfter } : {}),
          size: limit,
          sort: [{ _score: 'desc' }, { productId: 'asc' }],
          _source: ['productId', 'agentId', 'name', 'price', 'comparePrice', 'brand', 'categoryId', 'imageUrl', 'inStock', 'ratingAverage', 'ratingCount'],
          track_total_hits: true,
        },
      });

      const hits = response.body.hits;
      const lastSort = hits.hits.at(-1)?.sort;
      const result = {
        products: hits.hits.map((h: any) => ({ id: h._id, ...h._source, score: h._score })),
        total: typeof hits.total === 'object' ? hits.total.value : hits.total,
        page,
        limit,
        nextCursor: encodeSearchCursor(lastSort),
      };

      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));

      // Track popular keyword
      if (q) await redis.zincrby('search:popular', 1, q);

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

  app.get('/api/search/autocomplete', async (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!q || q.length > 100) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'q must contain 1 to 100 characters'));
      const matches: Array<{ keyword: string; count: number }> = [];
      let cursor = '0';
      const escaped = escapeRedisGlob(q);
      do {
        const [next, entries] = await redis.zscan('search:popular', cursor, 'MATCH', `${escaped}*`, 'COUNT', 100);
        cursor = next;
        for (let index = 0; index < entries.length; index += 2) {
          matches.push({ keyword: entries[index], count: Number(entries[index + 1]) });
        }
      } while (cursor !== '0' && matches.length < 50);
      matches.sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));
      res.json(successResponse(matches.slice(0, 10)));
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
