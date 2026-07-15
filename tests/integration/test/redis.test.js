const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRedisClient, DistributedLock } = require('@ecommerce/redis-client');

test('Redis distributed lock acquisition and token-safe release are atomic', { timeout: 10000 }, async () => {
  const redis = createRedisClient({
    host: process.env.INTEGRATION_REDIS_HOST ?? 'localhost',
    port: Number(process.env.INTEGRATION_REDIS_PORT ?? 6379),
    password: process.env.INTEGRATION_REDIS_PASSWORD || undefined,
    db: Number(process.env.INTEGRATION_REDIS_DB ?? 15),
    options: { connectTimeout: 3000, retryStrategy: () => null },
  });
  const lock = new DistributedLock(redis, 5000);
  const resource = `integration:${randomUUID()}`;
  try {
    await redis.ping();
    assert.equal(await lock.acquire(resource, 'owner-a'), true);
    assert.equal(await lock.acquire(resource, 'owner-b'), false);
    assert.equal(await lock.release(resource, 'owner-b'), false);
    assert.equal(await lock.acquire(resource, 'owner-b'), false);
    assert.equal(await lock.release(resource, 'owner-a'), true);
    assert.equal(await lock.acquire(resource, 'owner-b'), true);
    assert.equal(await lock.release(resource, 'owner-b'), true);
  } finally {
    await redis.del(`lock:${resource}`).catch(() => {});
    redis.disconnect();
  }
});
