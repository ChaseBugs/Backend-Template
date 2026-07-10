import { RedisClient } from './client';

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

export class DistributedLock {
  private readonly ttlMs: number;

  constructor(
    private readonly redis: RedisClient,
    ttlMs = 5000,
  ) {
    this.ttlMs = ttlMs;
  }

  async acquire(resource: string, token: string): Promise<boolean> {
    const key = `lock:${resource}`;
    const result = await (this.redis as any).set(key, token, 'PX', this.ttlMs, 'NX');
    return result === 'OK';
  }

  async release(resource: string, token: string): Promise<boolean> {
    const key = `lock:${resource}`;
    const result = await (this.redis as any).eval(RELEASE_SCRIPT, 1, key, token);
    return result === 1;
  }

  async withLock<T>(
    resource: string,
    fn: () => Promise<T>,
    options: { retries?: number; retryDelayMs?: number } = {},
  ): Promise<T> {
    const { retries = 3, retryDelayMs = 100 } = options;
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let attempts = 0;

    while (attempts <= retries) {
      const acquired = await this.acquire(resource, token);
      if (acquired) {
        try {
          return await fn();
        } finally {
          await this.release(resource, token);
        }
      }
      attempts++;
      if (attempts <= retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempts));
      }
    }

    throw new Error(`Could not acquire lock for resource: ${resource} after ${retries} retries`);
  }
}
