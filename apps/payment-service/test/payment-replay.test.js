const test = require('node:test');
const assert = require('node:assert/strict');
const { ProcessPaymentUseCase } = require('../dist/application/use-cases/process-payment.use-case');

const logger = { info() {}, warn() {}, error() {} };
const completed = {
  id: 'pay1', orderId: 'order1', sagaId: 'saga1', userId: 'user1', amount: 12000,
  method: 'CARD', status: 'COMPLETED', transactionId: 'txn1', idempotencyKey: 'key1',
  createdAt: new Date(), updatedAt: new Date(),
};

test('idempotent payment retry republishes the persisted completion event', async () => {
  const sent = [];
  const repo = { findByIdempotencyKey: async () => completed };
  const producer = { send: async (...args) => sent.push(args) };
  const useCase = new ProcessPaymentUseCase(repo, producer, {}, logger);
  const result = await useCase.execute({
    orderId: 'order1', sagaId: 'saga1', userId: 'user1', amount: 12000,
    method: 'CARD', idempotencyKey: 'key1',
  });
  assert.equal(result, completed);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'payment.completed');
  assert.equal(sent[0][1].payload.transactionId, 'txn1');
});

test('refund retry republishes an identical persisted refund', async () => {
  const sent = [];
  const refund = { id: 'refund1', paymentId: 'pay1', orderId: 'order1', referenceId: 'return1', agentId: 'agent1', amount: 12000, reason: 'returned' };
  const repo = {
    findRefundByReference: async () => refund,
    findById: async () => completed,
    sumRefunds: async () => 12000,
  };
  const producer = { send: async (...args) => sent.push(args) };
  const useCase = new ProcessPaymentUseCase(repo, producer, {}, logger);
  await useCase.refund('pay1', 12000, 'returned', 'return1', 'agent1');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'payment.refunded');
  assert.equal(sent[0][1].payload.paymentId, 'pay1');
  assert.equal(sent[0][1].payload.referenceId, 'return1');
  assert.equal(sent[0][1].payload.agentId, 'agent1');
  assert.equal(sent[0][1].payload.totalRefunded, 12000);
  assert.equal(sent[0][1].payload.paymentStatus, 'COMPLETED');
});

test('pending payment retry resumes gateway processing with the persisted payment id', async () => {
  const sent = [];
  const gatewayCalls = [];
  const pending = { ...completed, status: 'PENDING', transactionId: undefined };
  const finalized = { ...completed, transactionId: 'txn-resumed' };
  const repo = {
    findByIdempotencyKey: async () => pending,
    finalizePending: async (id, status, extra) => {
      assert.equal(id, 'pay1');
      assert.equal(status, 'COMPLETED');
      assert.equal(extra.transactionId, 'txn-resumed');
      return finalized;
    },
    findById: async () => finalized,
  };
  const gateway = async (...args) => { gatewayCalls.push(args); return { status: 'SUCCESS', transactionId: 'txn-resumed' }; };
  const useCase = new ProcessPaymentUseCase(repo, { send: async (...args) => sent.push(args) }, {}, logger, gateway);
  const result = await useCase.execute({
    orderId: 'order1', sagaId: 'saga1', userId: 'user1', amount: 12000, method: 'CARD', idempotencyKey: 'key1',
  });
  assert.equal(result, finalized);
  assert.equal(gatewayCalls[0][3], 'pay1');
  assert.equal(sent[0][0], 'payment.completed');
});

test('gateway transport failure leaves a pending payment resumable', async () => {
  let finalized = false;
  const pending = { ...completed, status: 'PENDING', transactionId: undefined };
  const repo = {
    findByIdempotencyKey: async () => pending,
    finalizePending: async () => { finalized = true; },
  };
  const useCase = new ProcessPaymentUseCase(repo, { send: async () => {} }, {}, logger, async () => { throw new Error('timeout'); });
  await assert.rejects(useCase.execute({
    orderId: 'order1', sagaId: 'saga1', userId: 'user1', amount: 12000, method: 'CARD', idempotencyKey: 'key1',
  }), /Payment gateway/);
  assert.equal(finalized, false);
});

test('pending refund retry uses the persisted refund id as gateway idempotency key', async () => {
  const refund = {
    id: 'refund1', paymentId: 'pay1', orderId: 'order1', referenceId: 'return1',
    amount: 3000, reason: 'returned', status: 'PENDING',
  };
  const calls = [];
  let finalized;
  const repo = {
    findRefundByReference: async () => refund,
    findById: async () => completed,
    finalizePendingRefund: async (...args) => { finalized = args; return null; },
  };
  const useCase = new ProcessPaymentUseCase(
    repo, { send: async () => {} }, {}, logger,
    async () => ({ status: 'SUCCESS', transactionId: 'unused' }),
    async (...args) => { calls.push(args); throw new Error('response lost'); },
  );
  await assert.rejects(useCase.refund('pay1', 3000, 'returned', 'return1'), /Refund gateway/);
  assert.deepEqual(calls[0], ['txn1', 3000, 'returned', 'refund1']);
  assert.equal(finalized, undefined);
});

test('gateway-declined refund becomes failed without changing payment state', async () => {
  const refund = {
    id: 'refund1', paymentId: 'pay1', orderId: 'order1', referenceId: 'return1',
    amount: 3000, reason: 'returned', status: 'PENDING',
  };
  const finalized = [];
  const repo = {
    findRefundByReference: async () => refund,
    findById: async () => completed,
    finalizePendingRefund: async (...args) => { finalized.push(args); return { ...refund, status: 'FAILED' }; },
  };
  const useCase = new ProcessPaymentUseCase(
    repo, { send: async () => {} }, {}, logger,
    async () => ({ status: 'SUCCESS', transactionId: 'unused' }),
    async () => ({ status: 'FAILED', transactionId: '', reason: 'not refundable' }),
  );
  await assert.rejects(useCase.refund('pay1', 3000, 'returned', 'return1'), /not refundable/);
  assert.equal(finalized[0][0], 'refund1');
  assert.equal(finalized[0][1], 'FAILED');
  assert.equal(finalized[0][2].failureReason, 'not refundable');
});
