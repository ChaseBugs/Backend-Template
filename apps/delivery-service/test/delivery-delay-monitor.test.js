const test = require('node:test');
const assert = require('node:assert/strict');
const { DeliveryDelayMonitor } = require('../dist/delivery-delay.monitor');

test('publishes deterministic warnings for overdue preparing deliveries', async () => {
  const calls = [];
  const createdAt = new Date('2026-07-10T00:00:00.000Z');
  const marked = [];
  const monitor = new DeliveryDelayMonitor(
    {
      findOverduePreparing: async (cutoff, limit) => {
        assert.equal(cutoff.toISOString(), '2026-07-12T00:00:00.000Z');
        assert.equal(limit, 50);
        return [{ id: 'group-1', orderId: 'order-1', agentId: 'agent-1', createdAt }];
      },
      markDelayAlerted: async (id) => marked.push(id),
    },
    { send: async (...args) => calls.push(args) },
    72,
    50,
  );

  assert.equal(await monitor.scan(new Date('2026-07-15T00:00:00.000Z')), 1);
  assert.equal(calls[0][0], 'delivery.delayed');
  assert.equal(calls[0][1].payload.deliveryGroupId, 'group-1');
  assert.equal(calls[0][2], 'group-1');
  assert.equal(calls[0][3], 'group-1');
  assert.deepEqual(marked, ['group-1']);
});

test('does not mark a delivery alerted when Kafka publication fails', async () => {
  let marked = false;
  const monitor = new DeliveryDelayMonitor(
    {
      findOverduePreparing: async () => [{ id: 'group-1', orderId: 'order-1', agentId: 'agent-1', createdAt: new Date() }],
      markDelayAlerted: async () => { marked = true; },
    },
    { send: async () => { throw new Error('Kafka unavailable'); } },
    72,
    50,
  );
  await assert.rejects(monitor.scan(), /Kafka unavailable/);
  assert.equal(marked, false);
});
