const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateAgentSettlements } = require('../dist/application/use-cases/process-payment.use-case');

test('groups order lines by agent and calculates KRW commission', () => {
  const result = calculateAgentSettlements(
    [
      { productId: 'p1', agentId: 'a1', quantity: 2, unitPrice: 10000 },
      { productId: 'p2', agentId: 'a1', quantity: 1, unitPrice: 5000 },
      { productId: 'p3', agentId: 'a2', quantity: 3, unitPrice: 7000 },
    ],
    new Map([['a1', 5], ['a2', 7.5]]),
  );

  assert.deepEqual(result, [
    { agentId: 'a1', grossAmount: 25000, commissionRate: 5, commissionAmount: 1250, netAmount: 23750 },
    { agentId: 'a2', grossAmount: 21000, commissionRate: 7.5, commissionAmount: 1575, netAmount: 19425 },
  ]);
});

test('rounds fractional commission to whole KRW', () => {
  const [result] = calculateAgentSettlements(
    [{ productId: 'p1', agentId: 'a1', quantity: 1, unitPrice: 999 }],
    new Map([['a1', 5]]),
  );
  assert.equal(result.commissionAmount, 50);
  assert.equal(result.netAmount, 949);
});

test('allocates shipping revenue without charging product commission on it', () => {
  const [result] = calculateAgentSettlements(
    [
      { productId: 'p1', agentId: 'a1', quantity: 1, unitPrice: 10000, shippingFee: 3000 },
      { productId: 'p2', agentId: 'a1', quantity: 1, unitPrice: 5000, shippingFee: 0 },
    ],
    new Map([['a1', 10]]),
  );
  assert.deepEqual(result, {
    agentId: 'a1', grossAmount: 18000, commissionRate: 10, commissionAmount: 1500, netAmount: 16500,
  });
});

test('deducts allocated coupon discounts before seller commission and payout', () => {
  const [result] = calculateAgentSettlements(
    [{ productId: 'p1', agentId: 'a1', quantity: 2, unitPrice: 10000, discountAmount: 3000, shippingFee: 2500 }],
    new Map([['a1', 10]]),
  );
  assert.deepEqual(result, {
    agentId: 'a1', grossAmount: 19500, commissionRate: 10, commissionAmount: 1700, netAmount: 17800,
  });
});

test('rejects missing rates and invalid lines', () => {
  assert.throws(
    () => calculateAgentSettlements([{ productId: 'p1', agentId: 'a1', quantity: 1, unitPrice: 100 }], new Map()),
    /Commission rate/,
  );
  assert.throws(
    () => calculateAgentSettlements([{ productId: 'p1', agentId: 'a1', quantity: 0, unitPrice: 100 }], new Map([['a1', 5]])),
    /Invalid order items/,
  );
  assert.throws(
    () => calculateAgentSettlements([{ productId: 'p1', agentId: 'a1', quantity: 1, unitPrice: 100, discountAmount: 101 }], new Map([['a1', 5]])),
    /Invalid order items/,
  );
});
