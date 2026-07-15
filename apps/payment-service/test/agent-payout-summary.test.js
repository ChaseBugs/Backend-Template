const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAgentPayoutSummary } = require('../dist/application/agent-payout-summary');

test('buckets settlement status rows into pending, paid-out and held payouts', () => {
  const rows = [
    { status: 'PENDING', count: 2, netAmount: 6300, grossAmount: 7000, commissionAmount: 700 },
    { status: 'PROCESSING', count: 1, netAmount: 2400, grossAmount: 3000, commissionAmount: 600 },
    { status: 'COMPLETED', count: 3, netAmount: 9000, grossAmount: 10000, commissionAmount: 1000 },
    { status: 'HELD', count: 1, netAmount: 1500, grossAmount: 1700, commissionAmount: 200 },
    { status: 'CANCELLED', count: 1, netAmount: 500, grossAmount: 600, commissionAmount: 100 },
  ];

  const s = buildAgentPayoutSummary(rows);

  // Money the seller is still owed: awaiting payout + being processed.
  assert.equal(s.payoutPending, 6300 + 2400);
  assert.equal(s.paidOut, 9000);
  assert.equal(s.held, 1500);
  // Lifetime marketplace commission excludes cancelled settlements.
  assert.equal(s.lifetimeCommission, 700 + 600 + 1000 + 200);
  assert.equal(s.byStatus.PENDING.count, 2);
  assert.equal(s.byStatus.CANCELLED.netAmount, 500);
});

test('returns zeroed buckets and empty breakdown when there are no settlements', () => {
  const s = buildAgentPayoutSummary([]);
  assert.deepEqual(
    { payoutPending: s.payoutPending, paidOut: s.paidOut, held: s.held, lifetimeCommission: s.lifetimeCommission },
    { payoutPending: 0, paidOut: 0, held: 0, lifetimeCommission: 0 },
  );
  assert.deepEqual(s.byStatus, {});
});
