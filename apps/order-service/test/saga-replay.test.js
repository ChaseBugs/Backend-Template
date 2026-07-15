const test = require('node:test');
const assert = require('node:assert/strict');
const { OrderSagaHandler } = require('../dist/application/saga/order-saga.handler');

const logger = { info() {}, warn() {}, error() {} };

test('completed payment saga replay republishes ORDER_PAID without repeating writes', async () => {
  const writes = [];
  const sent = [];
  const repo = {
    getSaga: async () => ({ status: 'COMPLETED', items: [{ productId: 'p1', agentId: 'a1', quantity: 1, unitPrice: 100 }] }),
    findById: async () => ({ userId: 'u1' }),
    updateSaga: async (...args) => writes.push(['saga', ...args]),
    updateStatus: async (...args) => writes.push(['order', ...args]),
  };
  const producer = { send: async (...args) => sent.push(args) };
  const handler = new OrderSagaHandler(repo, producer, logger);
  await handler.onPaymentCompleted({ paymentId: 'pay1', orderId: 'o1', sagaId: 's1', amount: 100 });
  assert.equal(writes.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'order.paid');
  assert.equal(sent[0][1].payload.paymentId, 'pay1');
});

test('compensation replay republishes ORDER_CANCELLED without repeating writes', async () => {
  const writes = [];
  const sent = [];
  const repo = {
    getSaga: async () => ({ status: 'COMPENSATION_STARTED', items: [{ productId: 'p1', quantity: 1 }] }),
    updateSaga: async (...args) => writes.push(['saga', ...args]),
    updateStatus: async (...args) => writes.push(['order', ...args]),
  };
  const producer = { send: async (...args) => sent.push(args) };
  const handler = new OrderSagaHandler(repo, producer, logger);
  await handler.onPaymentFailed({ orderId: 'o1', sagaId: 's1', reason: 'declined' });
  assert.equal(writes.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'order.cancelled');
});

test('full refund transitions the order and republishes read-model synchronization', async () => {
  const writes = [];
  const sent = [];
  const repo = {
    findById: async () => ({ id: 'o1', paymentId: 'pay1', status: 'COMPLETED' }),
    updateStatus: async (...args) => writes.push(args),
  };
  const producer = { send: async (...args) => sent.push(args) };
  const handler = new OrderSagaHandler(repo, producer, logger);
  await handler.onPaymentRefunded({ paymentId: 'pay1', orderId: 'o1', refundId: 'r1', paymentStatus: 'REFUNDED' });
  assert.deepEqual(writes[0], ['o1', 'REFUNDED']);
  assert.equal(sent[0][0], 'order.status.changed');
  assert.equal(sent[0][1].payload.status, 'REFUNDED');
});

test('partial refund does not change order status', async () => {
  let lookedUp = false;
  const repo = { findById: async () => { lookedUp = true; } };
  const handler = new OrderSagaHandler(repo, { send: async () => {} }, logger);
  await handler.onPaymentRefunded({ paymentId: 'pay1', orderId: 'o1', refundId: 'r1', paymentStatus: 'PARTIALLY_REFUNDED' });
  assert.equal(lookedUp, false);
});

test('delivery group progress advances order without regressing on an older replay', async () => {
  const writes = [];
  const sent = [];
  let current = 'PAID';
  const repo = {
    findById: async () => ({ id: 'o1', status: current }),
    updateStatus: async (_id, status) => { writes.push(status); current = status; },
  };
  const handler = new OrderSagaHandler(repo, { send: async (...args) => sent.push(args) }, logger);
  await handler.onDeliveryShipped({ orderId: 'o1', deliveryGroupId: 'g1', shippedGroups: 1, totalGroups: 2 });
  await handler.onDeliveryShipped({ orderId: 'o1', deliveryGroupId: 'g2', shippedGroups: 2, totalGroups: 2 });
  await handler.onDeliveryShipped({ orderId: 'o1', deliveryGroupId: 'g1', shippedGroups: 1, totalGroups: 2 });
  assert.deepEqual(writes, ['PARTIALLY_SHIPPED', 'SHIPPED']);
  assert.equal(sent[1][1].payload.status, 'SHIPPED');
});

test('late delivery completion cannot overwrite a refunded order', async () => {
  let written = false;
  const repo = {
    findById: async () => ({ id: 'o1', status: 'REFUNDED' }),
    updateStatus: async () => { written = true; },
  };
  const handler = new OrderSagaHandler(repo, { send: async () => { throw new Error('must not publish'); } }, logger);
  await handler.onAllDeliveriesCompleted({ orderId: 'o1' });
  assert.equal(written, false);
});
