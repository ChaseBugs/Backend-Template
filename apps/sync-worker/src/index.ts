import { MongoClient, Collection } from 'mongodb';
import { createLogger } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic } from '@ecommerce/shared';
import { createServer } from 'http';
import { createEventObservability } from '@ecommerce/logger';
import { projectBatch } from './projector';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';

const logger = createLogger({ service: 'sync-worker', level: process.env.LOG_LEVEL ?? 'info' });

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/ecommerce_read';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const observability = createEventObservability('sync-worker');

async function bootstrap(): Promise<void> {
  // MongoDB client
  const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 10 });
  await mongoClient.connect();
  const db = mongoClient.db('ecommerce_read');

  const productsColl: Collection = db.collection('products');
  const ordersColl: Collection = db.collection('orders');
  const usersColl: Collection = db.collection('users');
  const deliveriesColl: Collection = db.collection('deliveries');
  const agentsSearch = new OpenSearchClient({ node: process.env.OPENSEARCH_URL ?? 'http://localhost:9200' });
  const agentIndex = process.env.OPENSEARCH_AGENT_INDEX ?? 'agents';
  const userIndex = process.env.OPENSEARCH_USER_INDEX ?? 'users';

  // Redis for cache invalidation
  const redis = createRedisClient({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  }, logger);

  // Kafka consumer subscribes to ALL domain events
  const kafka = createKafka({ clientId: 'sync-worker', brokers: KAFKA_BROKERS });
  const consumer = new KafkaConsumer(kafka, {
    groupId: process.env.KAFKA_GROUP_ID ?? 'sync-worker-group',
    topics: [],
    dlqTopic: 'sync.events.dlq',
  }, logger);

  const topics = [
    KafkaTopic.USER_REGISTERED,
    KafkaTopic.USER_ROLE_CHANGED,
    KafkaTopic.USER_STATUS_CHANGED,
    KafkaTopic.AGENT_APPROVED,
    KafkaTopic.PRODUCT_CREATED,
    KafkaTopic.PRODUCT_UPDATED,
    KafkaTopic.PRODUCT_APPROVED,
    KafkaTopic.PRODUCT_REJECTED,
    KafkaTopic.PRODUCT_DELETED,
    KafkaTopic.ORDER_CREATED,
    KafkaTopic.PAYMENT_COMPLETED,
    KafkaTopic.PAYMENT_REFUNDED,
    KafkaTopic.ORDER_COMPLETED,
    KafkaTopic.ORDER_CANCELLED,
    KafkaTopic.ORDER_STATUS_CHANGED,
    KafkaTopic.DELIVERY_SHIPPED,
    KafkaTopic.DELIVERY_DELIVERED,
    KafkaTopic.DELIVERY_GROUP_CREATED,
    KafkaTopic.INVENTORY_DEDUCTED,
    KafkaTopic.INVENTORY_UPDATED,
    KafkaTopic.REVIEW_RATING_UPDATED,
  ];

  await consumer.connect({ topics, fromBeginning: false });
  const projectionConcurrency = parseInt(process.env.PROJECTION_CONCURRENCY ?? '8', 10);
  await consumer.runBatch(async (payloads) => {
    try {
      await projectBatch({
        products: productsColl,
        orders: ordersColl,
        users: usersColl,
        deliveries: deliveriesColl,
        agentsSearch,
        agentIndex,
        userIndex,
        redis,
      }, payloads.map((payload) => ({
        topic: payload.topic,
        event: consumer.parseMessage<any>(payload),
      })), projectionConcurrency);
      for (const payload of payloads) observability.record(payload.topic, 'success');
      logger.debug({ size: payloads.length, topic: payloads[0]?.topic }, 'Sync batch processed');
    } catch (err) {
      for (const payload of payloads) observability.record(payload.topic, 'failure');
      logger.error({ err, size: payloads.length, topic: payloads[0]?.topic }, 'Sync batch failed');
      throw err;
    }
  });

  logger.info('sync-worker started, listening for events');

  const monitoringPort = parseInt(process.env.PORT ?? '3012', 10);
  const monitoringServer = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', service: 'sync-worker' }));
    }
    if (req.url === '/ready') {
      let mongoReady = false;
      try {
        await db.command({ ping: 1 });
        mongoReady = true;
      } catch { /* reported below */ }
      let searchReady = false;
      try { searchReady = Boolean((await agentsSearch.ping()).body); } catch { /* reported below */ }
      const dependencies = { mongodb: mongoReady ? 'up' : 'down', opensearch: searchReady ? 'up' : 'down', kafka: consumer.isReady() ? 'up' : 'down' };
      const ready = mongoReady && searchReady && consumer.isReady();
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: ready ? 'ready' : 'not-ready', dependencies }));
    }
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': observability.registry.contentType });
      return res.end(await observability.registry.metrics());
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'not-found' }));
  });
  monitoringServer.listen(monitoringPort, '127.0.0.1', () => logger.info({ monitoringPort }, 'sync-worker monitoring endpoint started'));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
    monitoringServer.close();
    await consumer.disconnect();
    await mongoClient.close();
    redis.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => { logger.fatal({ err }, 'Uncaught exception'); process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });
}

bootstrap().catch((err) => { console.error('Failed to start sync-worker:', err); process.exit(1); });
