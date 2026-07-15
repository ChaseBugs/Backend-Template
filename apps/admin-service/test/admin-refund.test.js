const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAdminRefundInput } = require('../dist/admin-refund');

const paymentId = '1c7a71a7-4fd1-4a0f-9f5f-bd310fcedf40';

test('admin refund input is normalized before forwarding', () => {
  assert.deepEqual(parseAdminRefundInput(paymentId, {
    refundAmount: '12500',
    reason: '  damaged item  ',
    idempotencyKey: '  admin-refund-1  ',
  }), {
    refundAmount: 12500,
    reason: 'damaged item',
    idempotencyKey: 'admin-refund-1',
  });
});

test('admin refund input rejects invalid identifiers and unsafe amounts', () => {
  assert.throws(() => parseAdminRefundInput('not-a-uuid', {}), /UUID/);
  assert.throws(() => parseAdminRefundInput(paymentId, { refundAmount: 1.5, reason: 'x', idempotencyKey: 'k' }), /positive integer/);
  assert.throws(() => parseAdminRefundInput(paymentId, { refundAmount: 1, reason: ' ', idempotencyKey: 'k' }), /reason/);
  assert.throws(() => parseAdminRefundInput(paymentId, { refundAmount: 1, reason: 'x', idempotencyKey: '' }), /idempotencyKey/);
});
