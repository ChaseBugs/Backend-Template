import { IncrementResponse, Store } from 'express-rate-limit';
import { RedisClient } from '@ecommerce/redis-client';

const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

export class RedisRateLimitStore implements Store {
  private windowMs = 60_000;

  constructor(private readonly redis: RedisClient, private readonly keyPrefix = 'rate-limit:gateway:') {}

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    const [totalHits, ttl] = await this.redis.eval(INCREMENT_SCRIPT, 1, `${this.keyPrefix}${key}`, this.windowMs) as [number, number];
    return { totalHits: Number(totalHits), resetTime: new Date(Date.now() + Math.max(Number(ttl), 0)) };
  }

  async decrement(key: string): Promise<void> {
    await this.redis.decr(`${this.keyPrefix}${key}`);
  }

  async resetKey(key: string): Promise<void> {
    await this.redis.del(`${this.keyPrefix}${key}`);
  }
}
