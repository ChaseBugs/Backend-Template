const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyInventoryHealth } = require('../dist/application/inventory-health');

test('classifies agent SKUs into out-of-stock, low and healthy with an actionable list', () => {
  const rows = [
    { productId: 'p1', quantity: 0, reservedQuantity: 0, lowStockThreshold: 5 },   // out of stock
    { productId: 'p2', quantity: 3, reservedQuantity: 1, lowStockThreshold: 5 },   // low
    { productId: 'p3', quantity: 5, reservedQuantity: 0, lowStockThreshold: 5 },   // low (at threshold)
    { productId: 'p4', quantity: 20, reservedQuantity: 0, lowStockThreshold: 5 },  // healthy
  ];

  const s = classifyInventoryHealth(rows);

  assert.equal(s.totalSkus, 4);
  assert.equal(s.outOfStock, 1);
  assert.equal(s.lowStock, 2);
  assert.equal(s.healthy, 1);
  // Actionable items are out + low, most urgent (lowest available) first.
  assert.deepEqual(s.lowStockItems.map((i) => i.productId), ['p1', 'p2', 'p3']);
  assert.equal(s.lowStockItems[0].quantity, 0);
});

test('empty inventory yields zeroed counts and an empty action list', () => {
  const s = classifyInventoryHealth([]);
  assert.deepEqual(
    { totalSkus: s.totalSkus, outOfStock: s.outOfStock, lowStock: s.lowStock, healthy: s.healthy },
    { totalSkus: 0, outOfStock: 0, lowStock: 0, healthy: 0 },
  );
  assert.deepEqual(s.lowStockItems, []);
});
