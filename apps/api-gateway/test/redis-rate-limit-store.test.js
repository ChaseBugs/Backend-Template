const test = require('node:test');
const assert = require('node:assert/strict');
const { RedisRateLimitStore } = require('../dist/middleware/redis-rate-limit-store');

test('uses one atomic Redis operation and reports the shared reset window', async () => {
  const calls = [];
  const redis = {
    eval: async (...args) => { calls.push(args); return [3, 45000]; },
    decr: async () => {},
    del: async () => {},
  };
  const store = new RedisRateLimitStore(redis, 'test:');
  store.init({ windowMs: 60000 });
  const before = Date.now();
  const result = await store.increment('client');
  assert.equal(result.totalHits, 3);
  assert.equal(calls[0][2], 'test:client');
  assert.equal(calls[0][3], 60000);
  assert.ok(result.resetTime.getTime() >= before + 44000);
});
