const test = require('node:test');
const assert = require('node:assert/strict');
const { checkServiceReadiness } = require('../dist/readiness');

test('gateway readiness checks downstream readiness instead of liveness', async () => {
  const requested = [];
  const result = await checkServiceReadiness(
    { auth: 'http://auth.internal:3001', product: 'http://product.internal/base/' },
    100,
    async (url) => {
      requested.push(String(url));
      return { ok: true, json: async () => ({ status: 'ready' }) };
    },
  );
  assert.deepEqual(requested.sort(), [
    'http://auth.internal:3001/ready',
    'http://product.internal/base/ready',
  ]);
  assert.deepEqual(result, [['auth', 'up'], ['product', 'up']]);
});

test('gateway readiness rejects non-ready bodies, HTTP failures, and transport failures', async () => {
  const result = await checkServiceReadiness(
    { stale: 'http://stale', failed: 'http://failed', offline: 'http://offline' },
    100,
    async (url) => {
      if (url.hostname === 'offline') throw new Error('unreachable');
      if (url.hostname === 'failed') return { ok: false, json: async () => ({ status: 'ready' }) };
      return { ok: true, json: async () => ({ status: 'ok' }) };
    },
  );
  assert.deepEqual(result, [['stale', 'down'], ['failed', 'down'], ['offline', 'down']]);
});
