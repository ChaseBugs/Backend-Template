import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { z } from 'zod';
import { createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createRedisClient } from '@ecommerce/redis-client';
import { successResponse, errorResponse } from '@ecommerce/shared';
import { toHttpError, NotFoundError, ValidationError } from '@ecommerce/errors';
import { CartService, clearCartForOrderEvent } from './cart.service';
import { createKafka, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic } from '@ecommerce/shared';

const logger = createLogger({ service: 'cart-service', level: process.env.LOG_LEVEL ?? 'info' });
const PORT = parseInt(process.env.PORT ?? '3005', 10);

const CART_TTL = parseInt(process.env.CART_TTL_SECONDS ?? '2592000', 10);
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:3002';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-internal-token';

interface ResolvedProduct {
  productId: string;
  agentId: string;
  productName: string;
  productImage?: string;
  unitPrice: number;
}

async function resolveProduct(productId: string): Promise<ResolvedProduct> {
  const response = await fetch(`${PRODUCT_SERVICE_URL}/internal/products/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
    body: JSON.stringify({ productIds: [productId] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new NotFoundError('Active product', productId);
  const body = await response.json() as { data?: ResolvedProduct[] };
  const product = body.data?.[0];
  if (!product) throw new NotFoundError('Active product', productId);
  return product;
}

// Redis Hash: cart:{userId} → field=productId, value=JSON{quantity,unitPrice,productName,agentId}
const AddItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

const UpdateQuantitySchema = z.object({
  quantity: z.number().int().min(0),
});

async function bootstrap(): Promise<void> {
  const redis = createRedisClient({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  }, logger);

  const cartService = new CartService(redis as any, CART_TTL);
  const kafka = createKafka({
    clientId: 'cart-service',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });
  const consumer = new KafkaConsumer(kafka, {
    groupId: process.env.KAFKA_GROUP_ID ?? 'cart-service-group',
    topics: [],
    dlqTopic: 'cart.events.dlq',
    maxRetries: 3,
  }, logger);
  await consumer.connect({ topics: [KafkaTopic.ORDER_CREATED], fromBeginning: false });
  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<{ payload?: { userId?: string } }>(payload);
    const userId = await clearCartForOrderEvent(cartService, event);
    logger.debug({ userId }, 'Cart cleared after durable order creation');
  });

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  const observability = createHttpObservability('cart-service', logger);
  app.use(observability.middleware);

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    if (userId && userRole) req.user = { id: userId, role: userRole };
    next();
  };

  const requireUser = (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'cart-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'redis', check: () => redis.ping() },
    { name: 'kafka', check: async () => consumer.isReady() },
  ]));

  app.get('/api/cart', extractUser, requireUser, async (req: any, res: any, next: any) => {
    try {
      const items = await cartService.getCart(req.user.id);
      const total = items.reduce((sum: number, i: any) => sum + i.unitPrice * i.quantity, 0);
      res.json(successResponse({ items, total, count: items.length }));
    } catch (err) { next(err); }
  });

  app.post('/api/cart/items', extractUser, requireUser, async (req: any, res: any, next: any) => {
    try {
      const result = AddItemSchema.safeParse(req.body);
      if (!result.success) throw new ValidationError('Validation failed', result.error.errors);
      const { productId, quantity } = result.data;
      const product = await resolveProduct(productId);
      await cartService.addItem(req.user.id, productId, {
        quantity,
        unitPrice: product.unitPrice,
        productName: product.productName,
        productImage: product.productImage,
        agentId: product.agentId,
      });
      res.json(successResponse({ message: 'Item added to cart' }));
    } catch (err) { next(err); }
  });

  app.patch('/api/cart/items/:productId', extractUser, requireUser, async (req: any, res: any, next: any) => {
    try {
      const result = UpdateQuantitySchema.safeParse(req.body);
      if (!result.success) throw new ValidationError('Validation failed', result.error.errors);
      await cartService.updateQuantity(req.user.id, req.params.productId, result.data.quantity);
      res.json(successResponse({ message: 'Quantity updated' }));
    } catch (err) { next(err); }
  });

  app.delete('/api/cart/items/:productId', extractUser, requireUser, async (req: any, res: any, next: any) => {
    try {
      await cartService.removeItem(req.user.id, req.params.productId);
      res.json(successResponse({ message: 'Item removed' }));
    } catch (err) { next(err); }
  });

  app.delete('/api/cart', extractUser, requireUser, async (req: any, res: any, next: any) => {
    try {
      await cartService.clearCart(req.user.id);
      res.json(successResponse({ message: 'Cart cleared' }));
    } catch (err) { next(err); }
  });

  app.use((err: unknown, _req: any, res: any, _next: any) => {
    const { statusCode, code, message, details } = toHttpError(err);
    res.status(statusCode).json(errorResponse(code, message, details));
  });

  const server = app.listen(PORT, () => {
    logger.info(`cart-service listening on port ${PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
    server.close(async () => {
      await consumer.disconnect();
      redis.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => { console.error('Failed to start cart-service:', err); process.exit(1); });
