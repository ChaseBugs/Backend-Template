const test = require('node:test');
const assert = require('node:assert/strict');
const { DeliveryUseCases } = require('../dist/application/use-cases/delivery.use-cases');

const logger = { info() {}, warn() {}, error() {} };

test('buyer confirmation rejects another buyer before changing delivery state', async () => {
  let updated = false;
  const repo = {
    findById: async () => ({ id: 'g1', userId: 'owner', agentId: 'a1', status: 'SHIPPED' }),
    updateStatus: async () => { updated = true; },
  };
  const useCases = new DeliveryUseCases(repo, { send: async () => {} }, logger);
  await assert.rejects(useCases.confirmDelivered('g1', 'attacker'), /do not own/);
  assert.equal(updated, false);
});

test('shipment rejects empty tracking data before repository access', async () => {
  let read = false;
  const repo = { findById: async () => { read = true; } };
  const useCases = new DeliveryUseCases(repo, { send: async () => {} }, logger);
  await assert.rejects(useCases.ship('g1', 'a1', ' ', ''), /tracking number/);
  assert.equal(read, false);
});

test('admin status transition enforces the delivery state machine', async () => {
  const writes = [];
  const repo = {
    findById: async () => ({ id: 'g1', status: 'PREPARING' }),
    updateStatus: async (...args) => writes.push(args),
  };
  const useCases = new DeliveryUseCases(repo, { send: async () => {} }, logger);
  await useCases.updateStatusByAdmin('g1', 'FAILED');
  assert.deepEqual(writes[0], ['g1', 'FAILED']);
  await assert.rejects(useCases.updateStatusByAdmin('g1', 'RETURNED'), /Cannot change/);
});

test('order cancellation only delegates cancellation of preparing groups', async () => {
  const repo = { cancelPreparingByOrder: async (orderId) => { assert.equal(orderId, 'o1'); return 2; } };
  const useCases = new DeliveryUseCases(repo, { send: async () => {} }, logger);
  assert.equal(await useCases.cancelPreparingGroups('o1'), 2);
});

test('shipment event carries aggregate group progress for order synchronization', async () => {
  const sent = [];
  const repo = {
    findById: async () => ({ id: 'g1', orderId: 'o1', userId: 'u1', agentId: 'a1', status: 'PREPARING' }),
    updateStatus: async () => {},
    countFulfillmentStarted: async () => 1,
    countByOrder: async () => 2,
  };
  const useCases = new DeliveryUseCases(repo, { send: async (...args) => sent.push(args) }, logger);
  await useCases.ship('g1', 'a1', 'Courier', 'TRACK-1');
  assert.equal(sent[0][1].payload.shippedGroups, 1);
  assert.equal(sent[0][1].payload.totalGroups, 2);
});
