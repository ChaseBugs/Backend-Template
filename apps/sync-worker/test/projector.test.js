const test = require('node:test');
const assert = require('node:assert/strict');
const { projectBatch } = require('../dist/projector.js');
const { KafkaTopic } = require('@ecommerce/shared');

function dependencies() {
  const calls = { products: [], orders: [], users: [], deliveries: [], search: [], deleted: [] };
  return {
    calls,
    value: {
      products: { bulkWrite: async (ops, options) => { calls.products.push({ ops, options }); } },
      orders: { bulkWrite: async (ops, options) => { calls.orders.push({ ops, options }); } },
      users: { bulkWrite: async (ops, options) => { calls.users.push({ ops, options }); } },
      deliveries: { bulkWrite: async (ops, options) => { calls.deliveries.push({ ops, options }); } },
      agentsSearch: {
        index: async (request) => { calls.search.push({ method: 'index', ...request }); },
        update: async (request) => { calls.search.push({ method: 'update', ...request }); },
      },
      agentIndex: 'agents-test',
      userIndex: 'users-test',
      redis: { del: async (key) => { calls.deleted.push(key); } },
    },
  };
}

test('projects a Kafka batch with one ordered bulk write per collection', async () => {
  const { value, calls } = dependencies();
  await projectBatch(value, [
    { topic: KafkaTopic.USER_REGISTERED, event: { payload: { userId: 'u1', email: 'u@x', role: 'user' } } },
    { topic: KafkaTopic.PRODUCT_CREATED, event: { payload: { productId: 'p1', agentId: 'a1', name: 'P', price: 10, initialStock: 3 } } },
    { topic: KafkaTopic.PRODUCT_UPDATED, event: { payload: { productId: 'p1', changes: { name: 'P2' } } } },
    { topic: KafkaTopic.ORDER_CREATED, event: { occurredAt: '2026-01-01T00:00:00Z', payload: { orderId: 'o1', userId: 'u1', items: [] } } },
  ]);

  assert.equal(calls.products.length, 1);
  assert.equal(calls.products[0].ops.length, 2);
  assert.deepEqual(calls.products[0].options, { ordered: true });
  assert.equal(calls.orders[0].ops.length, 1);
  assert.equal(calls.users[0].ops.length, 1);
  assert.deepEqual(calls.deleted, ['product:p1']);
});

test('uses absolute inventory values and deduplicates cache invalidation', async () => {
  const { value, calls } = dependencies();
  await projectBatch(value, [{
    topic: KafkaTopic.INVENTORY_DEDUCTED,
    event: { payload: { items: [
      { productId: 'p1', available: 4 },
      { productId: 'p1', available: 3 },
      { productId: 'p2', available: 9 },
    ] } },
  }]);
  const ops = calls.products[0].ops;
  assert.equal(ops.length, 3);
  assert.equal(ops[1].updateOne.update.$set.stock, 3);
  assert.deepEqual(calls.deleted.sort(), ['product:p1', 'product:p2']);
});

test('delivery projection protects terminal order states', async () => {
  const { value, calls } = dependencies();
  await projectBatch(value, [{
    topic: KafkaTopic.DELIVERY_SHIPPED,
    event: { payload: { orderId: 'o1', totalGroups: 2, shippedGroups: 1 } },
  }]);
  const operation = calls.orders[0].ops[0].updateOne;
  assert.deepEqual(operation.filter.status.$nin, ['COMPLETED', 'CANCELLED', 'REFUNDED']);
  assert.equal(operation.update.$set.status, 'PARTIALLY_SHIPPED');
  assert.equal(calls.deliveries[0].ops[0].updateOne.update.$set.status, 'SHIPPED');
});

test('projects approved agents to OpenSearch and delivery groups to MongoDB', async () => {
  const { value, calls } = dependencies();
  await projectBatch(value, [
    { topic: KafkaTopic.AGENT_APPROVED, event: { occurredAt: '2026-01-01T00:00:00Z', payload: { agentId: 'a1', userId: 'u1', businessName: 'Seller' } } },
    { topic: KafkaTopic.DELIVERY_GROUP_CREATED, event: { occurredAt: '2026-01-01T00:00:01Z', payload: { deliveryGroupId: 'd1', orderId: 'o1', agentId: 'a1', items: [], shippingFee: 3000 } } },
    { topic: KafkaTopic.DELIVERY_DELIVERED, event: { payload: { deliveryGroupId: 'd1', orderId: 'o1', userId: 'u1', deliveredAt: '2026-01-02T00:00:00Z' } } },
  ]);
  assert.equal(calls.search.length, 1);
  assert.equal(calls.search[0].index, 'agents-test');
  assert.equal(calls.search[0].body.status, 'APPROVED');
  assert.equal(calls.deliveries.length, 1);
  assert.equal(calls.deliveries[0].ops.length, 2);
  assert.equal(calls.deliveries[0].ops[1].updateOne.update.$set.status, 'DELIVERED');
});

test('indexes registered users and applies role and active-state changes to both read models', async () => {
  const { value, calls } = dependencies();
  await projectBatch(value, [
    { topic: KafkaTopic.USER_REGISTERED, event: { occurredAt: '2026-01-01T00:00:00Z', payload: { userId: 'u1', email: 'u@example.com', role: 'user', firstName: 'U', lastName: 'One' } } },
    { topic: KafkaTopic.USER_ROLE_CHANGED, event: { payload: { userId: 'u1', role: 'admin' } } },
    { topic: KafkaTopic.USER_STATUS_CHANGED, event: { payload: { userId: 'u1', isActive: false } } },
  ]);
  assert.deepEqual(calls.search.map((call) => [call.method, call.index, call.id]), [
    ['index', 'users-test', 'u1'],
    ['update', 'users-test', 'u1'],
    ['update', 'users-test', 'u1'],
  ]);
  assert.equal(calls.users[0].ops[2].updateOne.update.$set.isActive, false);
  assert.equal(calls.search[2].body.doc.isActive, false);
});

test('rejects invalid backpressure configuration before acknowledging work', async () => {
  const { value } = dependencies();
  await assert.rejects(() => projectBatch(value, [], 0), /positive integer/);
});

test('propagates projection failures so Kafka cannot commit the batch', async () => {
  const { value, calls } = dependencies();
  value.products.bulkWrite = async () => { throw new Error('mongo unavailable'); };
  await assert.rejects(() => projectBatch(value, [{
    topic: KafkaTopic.PRODUCT_UPDATED,
    event: { payload: { productId: 'p1', changes: { name: 'x' } } },
  }]), /mongo unavailable/);
  assert.deepEqual(calls.deleted, []);
});

test('invalidates cache only after MongoDB projection has completed', async () => {
  const sequence = [];
  const { value } = dependencies();
  value.products.bulkWrite = async () => {
    sequence.push('write-start');
    await new Promise((resolve) => setTimeout(resolve, 5));
    sequence.push('write-end');
  };
  value.redis.del = async () => { sequence.push('invalidate'); };
  await projectBatch(value, [{
    topic: KafkaTopic.PRODUCT_UPDATED,
    event: { payload: { productId: 'p1', changes: { name: 'x' } } },
  }]);
  assert.deepEqual(sequence, ['write-start', 'write-end', 'invalidate']);
});
