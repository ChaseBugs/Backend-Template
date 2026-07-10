import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { z } from 'zod';
import { createLogger } from '@ecommerce/logger';
import { createRedisClient, RedisClient } from '@ecommerce/redis-client';
import { successResponse, errorResponse } from '@ecommerce/shared';
import { toHttpError, NotFoundError, ValidationError } from '@ecommerce/errors';

const logger = createLogger({ service: 'cart-service', level: process.env.LOG_LEVEL ?? 'info' });
const PORT = parseInt(process.env.PORT ?? '3005', 10);

const CART_TTL = 30 * 24 * 60 * 60; // 30 days

// Redis Hash: cart:{userId} → field=productId, value=JSON{quantity,unitPrice,productName,agentId}
class CartService {
  constructor(private readonly redis: RedisClient) {}

  private key(userId: string) { return `cart:${userId}`; }

  async getCart(userId: string): Promise<Record<string, unknown>[]> {
    const data = await (this.redis as any).hgetall(this.key(userId));
    if (!data) return [];
    return Object.entries(data).map(([productId, raw]) => ({
      productId,
      ...JSON.parse(raw as string),
    }));
  }

  async addItem(userId: string, productId: string, item: { quantity: number; unitPrice: number; productName: string; agentId: string }): Promise<void> {
    const existing = await (this.redis as any).hget(this.key(userId), productId);
    let quantity = item.quantity;
    if (existing) {
      const prev = JSON.parse(existing);
      quantity = prev.quantity + item.quantity;
    }
    await (this.redis as any).hset(this.key(userId), productId, JSON.stringify({ ...item, quantity }));
    await (this.redis as any).expire(this.key(userId), CART_TTL);
  }

  async updateQuantity(userId: string, productId: string, quantity: number): Promise<void> {
    const existing = await (this.redis as any).hget(this.key(userId), productId);
    if (!existing) throw new NotFoundError('Cart item', productId);
    if (quantity <= 0) {
      await (this.redis as any).hdel(this.key(userId), productId);
    } else {
      const item = JSON.parse(existing);
      await (this.redis as any).hset(this.key(userId), productId, JSON.stringify({ ...item, quantity }));
    }
  }

  async removeItem(userId: string, productId: string): Promise<void> {
    await (this.redis as any).hdel(this.key(userId), productId);
  }

  async clearCart(userId: string): Promise<void> {
    await (this.redis as any).del(this.key(userId));
  }

  async getItemCount(userId: string): Promise<number> {
    return (this.redis as any).hlen(this.key(userId));
  }
}

const AddItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  productName: z.string().min(1),
  agentId: z.string().uuid(),
});

const UpdateQuantitySchema = z.object({
  quantity: z.number().int().min(0),
});

async function bootstrap(): Promise<void> {
  const redis = createRedisClient({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  }, logger);

  const cartService = new CartService(redis);

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

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
      const { productId, ...item } = result.data;
      await cartService.addItem(req.user.id, productId, item);
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

  const shutdown = (signal: string) => {
    logger.info(`${signal} received`);
    server.close(() => { redis.disconnect(); process.exit(0); });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => { console.error('Failed to start cart-service:', err); process.exit(1); });
