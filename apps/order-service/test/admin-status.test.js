const test = require('node:test');
const assert = require('node:assert/strict');
const { AdminUpdateOrderStatusUseCase } = require('../dist/application/use-cases/admin-update-order-status.use-case');

test('administrative status override persists and publishes CQRS synchronization', async () => {
  const writes = [];
  const events = [];
  const useCase = new AdminUpdateOrderStatusUseCase({
    findById: async () => ({ id: 'order-1', status: 'PAID' }),
    updateStatus: async (...args) => writes.push(args),
  }, { send: async (...args) => events.push(args) });
  const result = await useCase.execute('order-1', 'PROCESSING', 'admin-1');
  assert.deepEqual(result, { previousStatus: 'PAID', status: 'PROCESSING' });
  assert.equal(writes.length, 1);
  assert.equal(events[0][0], 'order.status.changed');
});

test('administrative status replay republishes without rewriting', async () => {
  const events = [];
  const useCase = new AdminUpdateOrderStatusUseCase({
    findById: async () => ({ id: 'order-1', status: 'COMPLETED' }),
    updateStatus: async () => assert.fail('must not rewrite'),
  }, { send: async (...args) => events.push(args) });
  await useCase.execute('order-1', 'COMPLETED', 'admin-1');
  assert.equal(events.length, 1);
});
