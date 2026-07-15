const test = require('node:test');
const assert = require('node:assert/strict');
const { DeliveryUseCases } = require('../dist/application/use-cases/delivery.use-cases');

const logger = { info() {}, warn() {}, error() {} };

test('completed return replay republishes without rewriting delivery state', async () => {
  const events = [];
  const repo = {
    findReturnById: async () => ({ id: 'return-1', deliveryGroupId: 'group-1', orderId: 'order-1', userId: 'user-1', status: 'COMPLETED', refundAmount: 5000 }),
    findById: async () => ({ id: 'group-1', orderId: 'order-1', userId: 'user-1', status: 'RETURNED', returnedAt: new Date('2026-01-01T00:00:00Z') }),
    updateReturnStatus: async () => assert.fail('must not rewrite'),
    updateStatus: async () => assert.fail('must not rewrite'),
  };
  const useCases = new DeliveryUseCases(repo, { send: async (...args) => events.push(args) }, logger);
  await useCases.completeReturn('return-1', 5000);
  assert.equal(events[0][0], 'delivery.return.completed');
  assert.equal(events[0][1].payload.userId, 'user-1');
});
