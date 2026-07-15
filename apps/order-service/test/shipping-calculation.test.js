const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateShippingFees, isRemotePostalCode } = require('../dist/application/use-cases/create-order.use-case');

test('charges each seller once and applies seller-specific free-shipping thresholds', () => {
  const fees = calculateShippingFees(
    [
      { agentId: 'a1', subtotal: 7000 },
      { agentId: 'a1', subtotal: 4000 },
      { agentId: 'a2', subtotal: 5000 },
    ],
    new Map([
      ['a1', { agentId: 'a1', baseShippingFee: 3000, freeShippingThreshold: 10000 }],
      ['a2', { agentId: 'a2', baseShippingFee: 2500, freeShippingThreshold: 20000 }],
    ]),
  );
  assert.deepEqual([...fees], [['a1', 0], ['a2', 2500]]);
});

test('adds remote-area surcharge even when the seller grants free base shipping', () => {
  const fees = calculateShippingFees(
    [{ agentId: 'a1', subtotal: 50000 }],
    new Map([['a1', { agentId: 'a1', baseShippingFee: 3000, freeShippingThreshold: 10000, remoteAreaFee: 4000 }]]),
    true,
  );
  assert.equal(fees.get('a1'), 4000);
  assert.equal(isRemotePostalCode('402-10', ['63', '402']), true);
  assert.equal(isRemotePostalCode('06234', ['63', '402']), false);
});

test('rejects a missing or invalid seller policy', () => {
  assert.throws(() => calculateShippingFees([{ agentId: 'a1', subtotal: 1000 }], new Map()), /Shipping policy/);
  assert.throws(
    () => calculateShippingFees([{ agentId: 'a1', subtotal: 1000 }], new Map([['a1', { agentId: 'a1', baseShippingFee: -1 }]])),
    /Shipping policy/,
  );
});
