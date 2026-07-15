const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { CreatePaymentSchema, CreateRefundSchema } = require('../dist/application/dtos/payment.dto');

test('payment request validation rejects malformed identifiers and empty keys', () => {
  assert.equal(CreatePaymentSchema.safeParse({ orderId: 'not-a-uuid', method: 'CARD', idempotencyKey: 'key' }).success, false);
  assert.equal(CreatePaymentSchema.safeParse({ orderId: randomUUID(), method: 'CASH', idempotencyKey: 'key' }).success, false);
  assert.equal(CreatePaymentSchema.safeParse({ orderId: randomUUID(), method: 'CARD', idempotencyKey: '' }).success, false);
  assert.equal(CreatePaymentSchema.safeParse({ orderId: randomUUID(), method: 'CARD', idempotencyKey: 'key' }).success, true);
});

test('refund request validation requires a positive amount and meaningful bounded reason', () => {
  assert.equal(CreateRefundSchema.safeParse({ refundAmount: 0, reason: 'reason', idempotencyKey: 'key' }).success, false);
  assert.equal(CreateRefundSchema.safeParse({ refundAmount: 1, reason: '   ', idempotencyKey: 'key' }).success, false);
  assert.equal(CreateRefundSchema.safeParse({ refundAmount: 1, reason: 'x'.repeat(501), idempotencyKey: 'key' }).success, false);
  assert.equal(CreateRefundSchema.safeParse({ refundAmount: 1, reason: 'damaged', idempotencyKey: 'key' }).success, true);
});
