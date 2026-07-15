import { RedisClient } from './client';

// Atomically deducts stock. Returns new quantity, -1 if no cache, -2 if insufficient stock.
const DEDUCT_STOCK_SCRIPT = `
local current = tonumber(redis.call('get', KEYS[1]))
if current == nil then return -1 end
if current < tonumber(ARGV[1]) then return -2 end
return redis.call('decrby', KEYS[1], ARGV[1])
`;

// Atomically reserves (temporary hold) stock without deducting.
const RESERVE_STOCK_SCRIPT = `
local current = tonumber(redis.call('get', KEYS[1]))
if current == nil then return -1 end
local reserved = tonumber(redis.call('get', KEYS[2])) or 0
local available = current - reserved
if available < tonumber(ARGV[1]) then return -2 end
redis.call('incrby', KEYS[2], ARGV[1])
return available - tonumber(ARGV[1])
`;

const RELEASE_RESERVATION_SCRIPT = `
local reserved = tonumber(redis.call('get', KEYS[1])) or 0
local amount = tonumber(ARGV[1])
if reserved < amount then return -1 end
return redis.call('decrby', KEYS[1], amount)
`;

export class StockManager {
  constructor(private readonly redis: RedisClient) {}

  async deductStock(productId: string, quantity: number): Promise<number> {
    const key = `stock:${productId}`;
    const result = await (this.redis as any).eval(DEDUCT_STOCK_SCRIPT, 1, key, quantity);
    return result as number;
  }

  async reserveStock(productId: string, quantity: number): Promise<number> {
    const stockKey = `stock:${productId}`;
    const reservedKey = `stock:reserved:${productId}`;
    const result = await (this.redis as any).eval(RESERVE_STOCK_SCRIPT, 2, stockKey, reservedKey, quantity);
    return result as number;
  }

  async releaseReservation(productId: string, quantity: number): Promise<boolean> {
    const reservedKey = `stock:reserved:${productId}`;
    const result = await (this.redis as any).eval(RELEASE_RESERVATION_SCRIPT, 1, reservedKey, quantity);
    return result >= 0;
  }

  async setStock(productId: string, quantity: number): Promise<void> {
    await (this.redis as any).set(`stock:${productId}`, quantity);
  }

  async getStock(productId: string): Promise<number | null> {
    const val = await (this.redis as any).get(`stock:${productId}`);
    return val !== null ? parseInt(val, 10) : null;
  }
}
