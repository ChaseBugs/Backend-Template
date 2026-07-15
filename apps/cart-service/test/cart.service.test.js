const test = require('node:test');
const assert = require('node:assert/strict');
const { CartService, ADD_CART_ITEM_SCRIPT, clearCartForOrderEvent } = require('../dist/cart.service.js');

function redisStub(overrides = {}) {
  return {
    eval: async () => 1, hgetall: async () => ({}), hget: async () => null,
    hset: async () => 1, hdel: async () => 1, expire: async () => 1,
    del: async () => 1, hlen: async () => 0, ...overrides,
  };
}

test('adds items with one atomic Redis script and renews TTL', async () => {
  const calls = [];
  const service = new CartService(redisStub({ eval: async (...args) => { calls.push(args); return 3; } }), 3600);
  const item = { quantity: 2, unitPrice: 1200, productName: 'Product', productImage: '/p.png', agentId: 'agent-1' };
  await service.addItem('user-1', 'product-1', item);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], ADD_CART_ITEM_SCRIPT);
  assert.deepEqual(calls[0].slice(1), [1, 'cart:user-1', 'product-1', JSON.stringify(item), 3600]);
});

test('quantity update preserves product snapshot and renews lifetime', async () => {
  const writes = []; const expirations = [];
  const service = new CartService(redisStub({
    hget: async () => JSON.stringify({ quantity: 1, unitPrice: 10, productName: 'P', agentId: 'a' }),
    hset: async (...args) => { writes.push(args); return 1; },
    expire: async (...args) => { expirations.push(args); return 1; },
  }), 120);
  await service.updateQuantity('u', 'p', 4);
  assert.equal(JSON.parse(writes[0][2]).quantity, 4);
  assert.deepEqual(expirations, [['cart:u', 120]]);
});

test('zero quantity removes an item and missing items are rejected', async () => {
  const deletes = [];
  const service = new CartService(redisStub({
    hget: async (_key, field) => field === 'exists' ? JSON.stringify({ quantity: 1 }) : null,
    hdel: async (...args) => { deletes.push(args); return 1; },
  }), 120);
  await service.updateQuantity('u', 'exists', 0);
  assert.deepEqual(deletes, [['cart:u', 'exists']]);
  await assert.rejects(() => service.updateQuantity('u', 'missing', 1), /Cart item/);
});

test('cart reads retain product and seller metadata', async () => {
  const service = new CartService(redisStub({
    hgetall: async () => ({ p1: JSON.stringify({ quantity: 2, unitPrice: 5, productName: 'P', agentId: 'a1' }) }),
  }), 120);
  assert.deepEqual(await service.getCart('u'), [
    { productId: 'p1', quantity: 2, unitPrice: 5, productName: 'P', agentId: 'a1' },
  ]);
});

test('invalid cart TTL is rejected during startup', () => {
  assert.throws(() => new CartService(redisStub(), 0), /positive integer/);
});

test('durable order event clears the owning user cart idempotently', async () => {
  const cleared = [];
  const service = { clearCart: async (userId) => { cleared.push(userId); } };
  const event = { payload: { userId: 'user-1' } };
  assert.equal(await clearCartForOrderEvent(service, event), 'user-1');
  assert.equal(await clearCartForOrderEvent(service, event), 'user-1');
  assert.deepEqual(cleared, ['user-1', 'user-1']);
});

test('malformed order event is rejected for Kafka retry and DLQ', async () => {
  await assert.rejects(() => clearCartForOrderEvent({ clearCart: async () => {} }, { payload: {} }), /missing userId/);
});
