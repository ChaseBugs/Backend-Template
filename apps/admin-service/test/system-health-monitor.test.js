const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_SYSTEM_HEALTH_TARGETS, parseHealthTargets, SystemHealthMonitor } = require('../dist/system-health.monitor.js');

test('default readiness coverage includes every externally managed service except the monitor itself', () => {
  const targets = parseHealthTargets(DEFAULT_SYSTEM_HEALTH_TARGETS);
  assert.deepEqual(targets.map((target) => target.name), [
    'api-gateway', 'auth-service', 'product-service', 'order-service', 'payment-service',
    'cart-service', 'search-service', 'inventory-service', 'notification-service',
    'delivery-service', 'review-service', 'sync-worker',
  ]);
});

test('parses and validates named readiness targets', () => {
  assert.deepEqual(parseHealthTargets('auth=http://localhost:3001/ready,orders=https://orders.local/ready'), [
    { name: 'auth', url: 'http://localhost:3001/ready' },
    { name: 'orders', url: 'https://orders.local/ready' },
  ]);
  assert.throws(() => parseHealthTargets('auth=http://localhost/ready,auth=http://other/ready'), /duplicate/);
  assert.throws(() => parseHealthTargets('auth=file:///tmp/ready'), /protocol/);
});

test('emits one warning after consecutive failures and rearms after recovery', async () => {
  const events = [];
  let healthy = false;
  const monitor = new SystemHealthMonitor(
    [{ name: 'auth-service', url: 'http://localhost:3001/ready' }],
    { send: async (...args) => events.push(args) },
    2,
    async () => { if (!healthy) throw new Error('down'); },
  );

  await monitor.scan(new Date('2026-07-15T00:00:00.000Z'));
  assert.equal(events.length, 0);
  await monitor.scan(new Date('2026-07-15T00:01:00.000Z'));
  await monitor.scan(new Date('2026-07-15T00:02:00.000Z'));
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'system.warning');
  assert.equal(events[0][1].payload.consecutiveFailures, 2);
  assert.equal(events[0][2], 'auth-service');
  assert.match(events[0][3], /^[0-9a-f-]{36}$/);

  healthy = true;
  await monitor.scan();
  healthy = false;
  await monitor.scan();
  await monitor.scan();
  assert.equal(events.length, 2);
});

test('retries warning publication when Kafka is unavailable', async () => {
  let attempts = 0;
  const monitor = new SystemHealthMonitor(
    [{ name: 'auth-service', url: 'http://localhost:3001/ready' }],
    { send: async () => { attempts += 1; if (attempts === 1) throw new Error('Kafka unavailable'); } },
    1,
    async () => { throw new Error('down'); },
  );
  await assert.rejects(monitor.scan(), /Kafka unavailable/);
  await monitor.scan();
  assert.equal(attempts, 2);
});
