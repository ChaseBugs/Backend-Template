const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFulfillmentSummary } = require('../dist/application/fulfillment-summary');

test('buckets delivery-group status counts into a seller fulfillment queue', () => {
  const rows = [
    { status: 'PREPARING', count: 4 },
    { status: 'SHIPPED', count: 2 },
    { status: 'IN_TRANSIT', count: 1 },
    { status: 'DELIVERED', count: 10 },
    { status: 'RETURN_REQUESTED', count: 1 },
    { status: 'FAILED', count: 1 },
    { status: 'CANCELLED', count: 3 },
  ];

  const s = buildFulfillmentSummary(rows);

  assert.equal(s.toShip, 4);              // PREPARING awaits the seller's shipment
  assert.equal(s.inTransit, 3);           // SHIPPED + IN_TRANSIT
  assert.equal(s.delivered, 10);
  assert.equal(s.returnRequested, 1);
  // Everything that needs the seller to act now.
  assert.equal(s.actionNeeded, 4 + 1 + 1); // toShip + returnRequested + failed
  assert.equal(s.byStatus.PREPARING, 4);
  assert.equal(s.byStatus.CANCELLED, 3);
});

test('empty delivery history yields zeroed buckets', () => {
  const s = buildFulfillmentSummary([]);
  assert.deepEqual(
    { toShip: s.toShip, inTransit: s.inTransit, delivered: s.delivered, returnRequested: s.returnRequested, actionNeeded: s.actionNeeded },
    { toShip: 0, inTransit: 0, delivered: 0, returnRequested: 0, actionNeeded: 0 },
  );
  assert.deepEqual(s.byStatus, {});
});
