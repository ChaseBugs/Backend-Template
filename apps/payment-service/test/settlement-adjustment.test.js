const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateRefundToSettlements } = require('../dist/application/settlement-adjustment');

const settlements = [
  { id: 'a', agentId: 'agent-a', grossAmount: 7000, commissionAmount: 700, netAmount: 6300, status: 'COMPLETED' },
  { id: 'b', agentId: 'agent-b', grossAmount: 3000, commissionAmount: 600, netAmount: 2400, status: 'PENDING' },
];

test('allocates a refund proportionally and only flags completed payouts for clawback', () => {
  const result = allocateRefundToSettlements(5000, settlements);
  assert.deepEqual(result, [
    { settlementId: 'a', agentId: 'agent-a', grossAmount: 3500, commissionReversal: 350, netAmount: 3150, requiresClawback: true },
    { settlementId: 'b', agentId: 'agent-b', grossAmount: 1500, commissionReversal: 300, netAmount: 1200, requiresClawback: false },
  ]);
  assert.equal(result.reduce((sum, row) => sum + row.grossAmount, 0), 5000);
});

test('seller-scoped refund is allocated only to that seller settlement', () => {
  const result = allocateRefundToSettlements(1000, settlements, 'agent-b');
  assert.deepEqual(result, [
    { settlementId: 'b', agentId: 'agent-b', grossAmount: 1000, commissionReversal: 200, netAmount: 800, requiresClawback: false },
  ]);
});

test('caps recovery at the selected settlements gross value', () => {
  const result = allocateRefundToSettlements(5000, settlements, 'agent-b');
  assert.equal(result[0].grossAmount, 3000);
  assert.equal(result[0].netAmount, 2400);
});
