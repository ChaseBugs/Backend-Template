const test = require('node:test');
const assert = require('node:assert/strict');
const { GetAgentSalesSummaryUseCase } = require('../dist/application/use-cases/agent-sales-summary.use-case');

test('aggregates agent revenue into totals, per-status breakdown and pending fulfillment', async () => {
  const calls = [];
  const useCase = new GetAgentSalesSummaryUseCase({
    getAgentSalesSummary: async (...args) => {
      calls.push(args);
      return {
        statusCounts: [
          { status: 'PAID', orderCount: 3, unitsSold: 5, grossSales: 50000 },
          { status: 'PROCESSING', orderCount: 1, unitsSold: 2, grossSales: 20000 },
          { status: 'COMPLETED', orderCount: 4, unitsSold: 9, grossSales: 90000 },
        ],
      };
    },
  });

  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-15T00:00:00Z');
  const result = await useCase.execute('agent-1', { from, to });

  assert.deepEqual(calls[0], ['agent-1', from, to]);
  assert.deepEqual(result.totals, { orderCount: 8, unitsSold: 16, grossSales: 160000 });
  assert.equal(result.byStatus.PAID.grossSales, 50000);
  // PAID + PROCESSING orders still need shipping; COMPLETED does not.
  assert.equal(result.pendingFulfillment, 4);
  assert.equal(result.period.from, from.toISOString());
  assert.equal(result.period.to, to.toISOString());
});

test('defaults the window to the trailing 30 days when no range is given', async () => {
  let received;
  const useCase = new GetAgentSalesSummaryUseCase({
    getAgentSalesSummary: async (_agentId, from, to) => { received = { from, to }; return { statusCounts: [] }; },
  });

  const before = Date.now();
  const result = await useCase.execute('agent-1');
  const after = Date.now();

  const spanMs = received.to.getTime() - received.from.getTime();
  assert.equal(spanMs, 30 * 24 * 60 * 60 * 1000);
  assert.ok(received.to.getTime() >= before && received.to.getTime() <= after);
  assert.deepEqual(result.totals, { orderCount: 0, unitsSold: 0, grossSales: 0 });
  assert.equal(result.pendingFulfillment, 0);
});

test('rejects an inverted range where from is after to', async () => {
  const useCase = new GetAgentSalesSummaryUseCase({
    getAgentSalesSummary: async () => assert.fail('must not query on an invalid range'),
  });

  await assert.rejects(
    () => useCase.execute('agent-1', { from: new Date('2026-07-15'), to: new Date('2026-07-01') }),
    /from must be on or before to/,
  );
});
