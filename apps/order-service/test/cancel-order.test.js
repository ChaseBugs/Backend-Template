const test = require('node:test');
const assert = require('node:assert/strict');
const { CancelOrderUseCase } = require('../dist/application/use-cases/cancel-order.use-case');

const order = {
  id: 'order-1', sagaId: 'saga-1', userId: 'user-1', status: 'PENDING',
  items: [{ productId: 'product-1', quantity: 1 }],
};

test('order owner cancellation persists and publishes inventory release event', async () => {
  const writes = [];
  const events = [];
  const useCase = new CancelOrderUseCase({
    findById: async () => order,
    updateStatus: async (...args) => writes.push(args),
  }, { send: async (...args) => events.push(args) });

  await useCase.execute(order.id, { id: order.userId, role: 'user' }, 'Changed my mind');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], 'CANCELLED');
  assert.equal(events[0][0], 'order.cancelled');
});

test('cancelled order retry republishes without repeating the write', async () => {
  const events = [];
  const useCase = new CancelOrderUseCase({
    findById: async () => ({ ...order, status: 'CANCELLED', cancelReason: 'Changed my mind' }),
    updateStatus: async () => assert.fail('must not rewrite'),
  }, { send: async (...args) => events.push(args) });

  await useCase.execute(order.id, { id: order.userId, role: 'user' }, 'Changed my mind');
  assert.equal(events.length, 1);
});

test('non-owner and invalid-state cancellation are rejected', async () => {
  const producer = { send: async () => assert.fail('must not publish') };
  const otherUser = new CancelOrderUseCase({ findById: async () => order }, producer);
  await assert.rejects(otherUser.execute(order.id, { id: 'user-2', role: 'user' }, 'No'), /Only the order owner/);

  const paid = new CancelOrderUseCase({ findById: async () => ({ ...order, status: 'PAID' }) }, producer);
  await assert.rejects(paid.execute(order.id, { id: order.userId, role: 'user' }, 'No'), /Cannot cancel/);
});
