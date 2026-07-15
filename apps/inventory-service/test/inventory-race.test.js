const test = require('node:test');
const assert = require('node:assert/strict');
const { InventoryUseCases } = require('../dist/application/use-cases/inventory.use-cases');

const logger = { info() {}, warn() {}, error() {} };
const transaction = async (work) => work({ transaction: true });
const inventory = { id: 'p1', productId: 'p1', agentId: 'a1', quantity: 10, reservedQuantity: 0, lowStockThreshold: 2, updatedAt: new Date() };

function harness(repoOverrides = {}, metrics = undefined, redisOverrides = {}) {
  const sent = [];
  const cacheWrites = [];
  const repo = {
    hasMovement: async () => false,
    reserve: async () => true,
    releaseReservation: async () => true,
    deductReserved: async () => ({ ...inventory, quantity: 3, reservedQuantity: 1 }),
    createMovement: async () => {},
    findByProductId: async () => inventory,
    ...repoOverrides,
  };
  const redis = { set: async (...args) => cacheWrites.push(args), get: async () => null, ...redisOverrides };
  const producer = { send: async (...args) => sent.push(args) };
  return { useCases: new InventoryUseCases(repo, redis, producer, logger, transaction, metrics), repo, sent, cacheWrites };
}

test('late order-created event cannot reserve after a cancellation tombstone', async () => {
  let reserveCalls = 0;
  const { useCases, sent, cacheWrites } = harness({
    hasMovement: async (_product, type) => type === 'RELEASE',
    reserve: async () => { reserveCalls++; return true; },
  });
  await useCases.reserveItems({ orderId: 'order1', sagaId: 'saga1', items: [{ productId: 'p1', quantity: 1 }] });
  assert.equal(reserveCalls, 0);
  assert.equal(sent.length, 0);
  assert.equal(cacheWrites.length, 0);
});

test('cancellation before reservation records a tombstone without reducing stock', async () => {
  let releaseCalls = 0;
  const movements = [];
  const { useCases, sent } = harness({
    releaseReservation: async () => { releaseCalls++; return true; },
    createMovement: async (movement) => movements.push(movement),
  });
  await useCases.releaseItems('order1', 'saga1', [{ productId: 'p1', quantity: 2 }]);
  assert.equal(releaseCalls, 0);
  assert.equal(movements[0].type, 'RELEASE');
  assert.equal(sent.at(-1)[0], 'inventory.released');
});

test('release fails instead of silently clamping an inconsistent reservation', async () => {
  const { useCases, sent } = harness({
    hasMovement: async (_product, type) => type === 'RESERVE',
    releaseReservation: async () => false,
  });
  await assert.rejects(
    useCases.releaseItems('order1', 'saga1', [{ productId: 'p1', quantity: 2 }]),
    /could not be released/,
  );
  assert.equal(sent.length, 0);
});

test('reservation failure emits a deterministic saga failure without cache mutation', async () => {
  const { useCases, sent, cacheWrites } = harness({ reserve: async () => false });
  await useCases.reserveItems({ orderId: 'order1', sagaId: 'saga1', items: [{ productId: 'p1', quantity: 20 }] });
  assert.equal(sent[0][0], 'inventory.reservation.failed');
  assert.equal(sent[0][1].payload.failedProductId, 'p1');
  assert.equal(cacheWrites.length, 0);
});

test('new deduction at the configured threshold emits one seller low-stock warning', async () => {
  const { useCases, sent } = harness({
    deductReserved: async () => ({ ...inventory, quantity: 3, reservedQuantity: 1, lowStockThreshold: 2 }),
  });
  await useCases.confirmDeduction('order1', [{ productId: 'p1', quantity: 2 }]);
  assert.equal(sent[0][0], 'inventory.deducted');
  assert.deepEqual(sent[0][1].payload.items, [{ productId: 'p1', quantity: 2, available: 2 }]);
  assert.equal(sent[1][0], 'stock.low');
  assert.deepEqual(sent[1][1].payload, { productId: 'p1', agentId: 'a1', available: 2, threshold: 2 });
});

test('deduction replay republishes inventory state without duplicate low-stock warning', async () => {
  const { useCases, sent } = harness({
    hasMovement: async (_productId, type) => type === 'OUT',
    findByProductId: async () => ({ ...inventory, quantity: 3, reservedQuantity: 1, lowStockThreshold: 2 }),
  });
  await useCases.confirmDeduction('order1', [{ productId: 'p1', quantity: 2 }]);
  assert.deepEqual(sent.map((entry) => entry[0]), ['inventory.deducted']);
});

test('records bounded reservation outcomes and cache hit/miss metrics', async () => {
  const reservations = [];
  const lookups = [];
  const metrics = {
    recordReservation: (result) => reservations.push(result),
    recordCacheLookup: (result) => lookups.push(result),
  };
  const successful = harness({}, metrics, { get: async () => '10' });
  await successful.useCases.reserveItems({ orderId: 'order1', sagaId: 'saga1', items: [{ productId: 'p1', quantity: 1 }] });
  assert.deepEqual(reservations, ['success']);
  assert.deepEqual(await successful.useCases.getStock('p1'), { productId: 'p1', available: 10, reserved: 0 });

  const failed = harness({ reserve: async () => false }, metrics, { get: async () => null });
  await failed.useCases.reserveItems({ orderId: 'order2', sagaId: 'saga2', items: [{ productId: 'p1', quantity: 20 }] });
  await failed.useCases.getStock('p1');
  assert.deepEqual(reservations, ['success', 'failure']);
  assert.deepEqual(lookups, ['hit', 'miss']);
});
