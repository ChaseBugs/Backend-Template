const test = require('node:test');
const assert = require('node:assert/strict');
const { createReadinessHandler } = require('../dist');

function responseCapture() {
  return {
    statusCode: 0,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };
}

test('readiness returns 200 only when every dependency is healthy', async () => {
  const response = responseCapture();
  const handler = createReadinessHandler([
    { name: 'database', check: async () => true },
    { name: 'cache', check: async () => true },
  ]);
  await handler({}, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: 'ready', dependencies: { database: 'up', cache: 'up' } });
});

test('readiness returns 503 for failures and timeouts', async () => {
  const response = responseCapture();
  const handler = createReadinessHandler([
    { name: 'database', check: async () => { throw new Error('offline'); } },
    { name: 'broker', check: () => new Promise(() => {}) },
  ], 10);
  await handler({}, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: 'not-ready', dependencies: { database: 'down', broker: 'down' } });
});

test('readiness treats an explicit false connection state as down', async () => {
  const response = responseCapture();
  const handler = createReadinessHandler([
    { name: 'producer', check: async () => false },
    { name: 'consumer', check: async () => true },
  ]);
  await handler({}, response);
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: 'not-ready', dependencies: { producer: 'down', consumer: 'up' } });
});
