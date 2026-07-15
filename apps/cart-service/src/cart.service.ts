import { NotFoundError } from '@ecommerce/errors';

export interface CartRedis {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  hlen(key: string): Promise<number>;
}

export interface CartItemInput {
  quantity: number;
  unitPrice: number;
  productName: string;
  productImage?: string;
  agentId: string;
}

export interface CartItem extends CartItemInput { productId: string; }

export const ADD_CART_ITEM_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
local incoming = cjson.decode(ARGV[2])
if raw then
  local current = cjson.decode(raw)
  incoming.quantity = current.quantity + incoming.quantity
end
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(incoming))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return incoming.quantity
`;

export class CartService {
  constructor(private readonly redis: CartRedis, private readonly ttlSeconds: number) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error('Cart TTL must be a positive integer');
  }

  private key(userId: string): string { return `cart:${userId}`; }

  async getCart(userId: string): Promise<CartItem[]> {
    const data = await this.redis.hgetall(this.key(userId));
    return Object.entries(data ?? {}).map(([productId, raw]) => ({ productId, ...JSON.parse(raw) as CartItemInput }));
  }

  async addItem(userId: string, productId: string, item: CartItemInput): Promise<void> {
    await this.redis.eval(ADD_CART_ITEM_SCRIPT, 1, this.key(userId), productId, JSON.stringify(item), this.ttlSeconds);
  }

  async updateQuantity(userId: string, productId: string, quantity: number): Promise<void> {
    const key = this.key(userId);
    const existing = await this.redis.hget(key, productId);
    if (!existing) throw new NotFoundError('Cart item', productId);
    if (quantity <= 0) await this.redis.hdel(key, productId);
    else {
      const item = JSON.parse(existing) as CartItemInput;
      await this.redis.hset(key, productId, JSON.stringify({ ...item, quantity }));
    }
    await this.redis.expire(key, this.ttlSeconds);
  }

  async removeItem(userId: string, productId: string): Promise<void> {
    const key = this.key(userId);
    await this.redis.hdel(key, productId);
    await this.redis.expire(key, this.ttlSeconds);
  }

  async clearCart(userId: string): Promise<void> { await this.redis.del(this.key(userId)); }
  async getItemCount(userId: string): Promise<number> { return this.redis.hlen(this.key(userId)); }
}

export async function clearCartForOrderEvent(
  cartService: Pick<CartService, 'clearCart'>,
  event: { payload?: { userId?: string } },
): Promise<string> {
  const userId = event.payload?.userId;
  if (!userId) throw new Error('ORDER_CREATED event is missing userId');
  await cartService.clearCart(userId);
  return userId;
}
