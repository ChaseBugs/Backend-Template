import { MongoClient, Collection } from 'mongodb';
import { createLogger } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { createKafka, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic } from '@ecommerce/shared';

const logger = createLogger({ service: 'sync-worker', level: process.env.LOG_LEVEL ?? 'info' });

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/ecommerce_read';
const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');

async function bootstrap(): Promise<void> {
  // MongoDB client
  const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 10 });
  await mongoClient.connect();
  const db = mongoClient.db('ecommerce_read');

  const productsColl: Collection = db.collection('products');
  const ordersColl: Collection = db.collection('orders');
  const usersColl: Collection = db.collection('users');

  // Redis for cache invalidation
  const redis = createRedisClient({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  }, logger);

  // Kafka consumer subscribes to ALL domain events
  const kafka = createKafka({ clientId: 'sync-worker', brokers: KAFKA_BROKERS });
  const consumer = new KafkaConsumer(kafka, { groupId: 'sync-worker-group', topics: [] }, logger);

  const topics = [
    KafkaTopic.USER_REGISTERED,
    KafkaTopic.AGENT_APPROVED,
    KafkaTopic.PRODUCT_CREATED,
    KafkaTopic.PRODUCT_UPDATED,
    KafkaTopic.PRODUCT_APPROVED,
    KafkaTopic.PRODUCT_DELETED,
    KafkaTopic.ORDER_CREATED,
    KafkaTopic.PAYMENT_COMPLETED,
    KafkaTopic.ORDER_COMPLETED,
    KafkaTopic.ORDER_CANCELLED,
    KafkaTopic.DELIVERY_SHIPPED,
    KafkaTopic.DELIVERY_DELIVERED,
    KafkaTopic.INVENTORY_DEDUCTED,
  ];

  await consumer.connect({ topics, fromBeginning: false });
  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    const p = event.payload;

    try {
      switch (payload.topic) {
        // Sync user to MongoDB for denormalized reads
        case KafkaTopic.USER_REGISTERED:
          await usersColl.updateOne(
            { _id: p.userId },
            { $set: { _id: p.userId, email: p.email, role: p.role, firstName: p.firstName, lastName: p.lastName } },
            { upsert: true },
          );
          break;

        // Sync product to MongoDB + invalidate Redis
        case KafkaTopic.PRODUCT_CREATED:
        case KafkaTopic.PRODUCT_APPROVED:
          await productsColl.updateOne(
            { _id: p.productId },
            {
              $set: {
                _id: p.productId,
                agentId: p.agentId,
                name: p.name,
                price: p.price,
                categoryId: p.categoryId,
                brand: p.brand,
                tags: p.tags,
                stock: p.initialStock ?? 0,
                status: payload.topic === KafkaTopic.PRODUCT_APPROVED ? 'ACTIVE' : 'PENDING_APPROVAL',
                rating: { average: 0, count: 0 },
                viewCount: 0,
              },
            },
            { upsert: true },
          );
          await (redis as any).del(`product:${p.productId}`);
          break;

        case KafkaTopic.PRODUCT_UPDATED:
          await productsColl.updateOne({ _id: p.productId }, { $set: p.changes });
          await (redis as any).del(`product:${p.productId}`);
          break;

        case KafkaTopic.PRODUCT_DELETED:
          await productsColl.updateOne({ _id: p.productId }, { $set: { status: 'INACTIVE' } });
          await (redis as any).del(`product:${p.productId}`);
          break;

        // Sync stock count in MongoDB read model
        case KafkaTopic.INVENTORY_DEDUCTED:
          for (const item of p.items ?? []) {
            await productsColl.updateOne(
              { _id: item.productId },
              { $inc: { stock: -item.quantity } },
            );
          }
          break;

        // Sync orders to MongoDB for agent/admin views
        case KafkaTopic.ORDER_CREATED:
          await ordersColl.updateOne(
            { _id: p.orderId },
            { $set: { _id: p.orderId, userId: p.userId, status: 'PENDING', items: p.items, totalAmount: p.totalAmount, createdAt: event.occurredAt } },
            { upsert: true },
          );
          break;

        case KafkaTopic.PAYMENT_COMPLETED:
          await ordersColl.updateOne({ _id: p.orderId }, { $set: { status: 'PAID', paymentId: p.paymentId } });
          break;

        case KafkaTopic.ORDER_COMPLETED:
          await ordersColl.updateOne({ _id: p.orderId }, { $set: { status: 'COMPLETED' } });
          break;

        case KafkaTopic.ORDER_CANCELLED:
          await ordersColl.updateOne({ _id: p.orderId }, { $set: { status: 'CANCELLED' } });
          break;

        case KafkaTopic.DELIVERY_SHIPPED:
          await ordersColl.updateOne({ _id: p.orderId }, { $set: { status: 'SHIPPED' } });
          break;

        case KafkaTopic.DELIVERY_DELIVERED:
          await ordersColl.updateOne({ _id: p.orderId }, { $set: { lastDeliveredAt: event.occurredAt } });
          break;
      }

      logger.debug({ topic: payload.topic }, 'Sync event processed');
    } catch (err) {
      logger.error({ err, topic: payload.topic }, 'Sync error');
      throw err; // will retry
    }
  });

  logger.info('sync-worker started, listening for events');

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
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
