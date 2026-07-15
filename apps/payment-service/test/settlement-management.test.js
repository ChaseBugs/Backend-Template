const test = require('node:test');
const assert = require('node:assert/strict');
const { SettlementManagementUseCase } = require('../dist/application/settlement-management');

const transaction = async (work) => work({});
const settlement = (status = 'PENDING') => ({
  id: 'settlement-1', paymentId: 'payment-1', orderId: 'order-1', agentId: 'agent-1',
  grossAmount: 10000, commissionRate: 5, commissionAmount: 500, netAmount: 9500,
  status, settledAt: status === 'COMPLETED' ? new Date('2026-07-15T00:00:00Z') : undefined,
  createdAt: new Date('2026-07-01T00:00:00Z'),
});

test('payment service owns settlement completion and publishes a deterministic event', async () => {
  const calls = [];
  const completed = settlement('COMPLETED');
  const repository = {
    findSettlementForUpdate: async () => settlement('PROCESSING'),
    updateSettlementStatus: async () => completed,
  };
  const producer = { send: async (...args) => calls.push(args) };
  const result = await new SettlementManagementUseCase(repository, producer, transaction)
    .updateSettlement('settlement-1', 'COMPLETED');
  assert.equal(result.previousStatus, 'PROCESSING');
  assert.equal(calls[0][0], 'payment.agent-settlement.completed');
  assert.equal(calls[0][1].payload.netAmount, 9500);
  assert.equal(calls[0][2], 'settlement-1');
  assert.equal(calls[0][3], 'settlement-1');
});

test('settlement completion replay republishes without rewriting state', async () => {
  let writes = 0;
  let published = 0;
  const repository = {
    findSettlementForUpdate: async () => settlement('COMPLETED'),
    updateSettlementStatus: async () => { writes += 1; return settlement('COMPLETED'); },
  };
  await new SettlementManagementUseCase(repository, { send: async () => { published += 1; } }, transaction)
    .updateSettlement('settlement-1', 'COMPLETED');
  assert.equal(writes, 0);
  assert.equal(published, 1);
});

test('terminal settlement rollback and invalid adjustment transitions are rejected', async () => {
  const repository = {
    findSettlementForUpdate: async () => settlement('COMPLETED'),
    findSettlementAdjustmentForUpdate: async () => ({ id: 'adjustment-1', status: 'COMPLETED' }),
  };
  const useCase = new SettlementManagementUseCase(repository, { send: async () => {} }, transaction);
  await assert.rejects(useCase.updateSettlement('settlement-1', 'PROCESSING'), /Cannot change/);
  await assert.rejects(useCase.updateAdjustment('adjustment-1', 'PROCESSING'), /Cannot change/);
});

test('settlement adjustment advances in the payment transaction', async () => {
  let changed;
  const repository = {
    findSettlementAdjustmentForUpdate: async () => ({ id: 'adjustment-1', status: 'PENDING' }),
    updateSettlementAdjustmentStatus: async (_id, status) => { changed = status; return { id: 'adjustment-1', status }; },
  };
  const result = await new SettlementManagementUseCase(repository, { send: async () => {} }, transaction)
    .updateAdjustment('adjustment-1', 'PROCESSING');
  assert.equal(changed, 'PROCESSING');
  assert.equal(result.previousStatus, 'PENDING');
});
