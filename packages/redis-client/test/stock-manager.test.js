const test = require('node:test');
const assert = require('node:assert/strict');
const { StockManager } = require('../dist');

test('stock manager uses atomic scripts for reserve and token-safe bounded release', async () => {
  const calls = [];
  const redis = { eval: async (...args) => { calls.push(args); return calls.length === 1 ? -1 : -1; } };
  const manager = new StockManager(redis);
  assert.equal(await manager.reserveStock('p1', 2), -1);
  assert.equal(await manager.releaseReservation('p1', 2), false);
  assert.equal(calls[0][1], 2);
  assert.deepEqual(calls[0].slice(2), ['stock:{p1}', 'stock:reserved:{p1}', 2]);
  assert.equal(calls[1][1], 1);
  assert.deepEqual(calls[1].slice(2), ['stock:reserved:{p1}', 2]);
});

test('release reports success only when Redis kept the reservation non-negative', async () => {
  const manager = new StockManager({ eval: async () => 0 });
  assert.equal(await manager.releaseReservation('p1', 2), true);
});
