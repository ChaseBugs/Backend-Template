const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateOrderDiscount, calculateCouponDiscount } = require('../dist/application/use-cases/create-order.use-case');

const activeCoupon = (overrides = {}) => ({
  id: 'coupon-1', code: 'WELCOME10', discountType: 'PERCENT', discountValue: 10,
  minOrderAmount: 1000, maxDiscountAmount: 5000,
  startsAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date('2027-01-01T00:00:00Z'),
  usageLimit: 100, usedCount: 0, perUserLimit: 1, isActive: true,
  ...overrides,
});

test('percentage coupon applies a deterministic integer discount and maximum cap', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  assert.equal(calculateCouponDiscount(activeCoupon(), 12000, 0, now), 1200);
  assert.equal(calculateCouponDiscount(activeCoupon(), 100000, 0, now), 5000);
});

test('fixed coupon never discounts more than merchandise total', () => {
  const coupon = activeCoupon({ discountType: 'FIXED', discountValue: 10000, maxDiscountAmount: undefined });
  assert.equal(calculateCouponDiscount(coupon, 3000, 0, new Date('2026-07-01T00:00:00Z')), 3000);
});

test('coupon validity, global usage, per-user usage, and minimum amount are enforced', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  assert.throws(() => calculateCouponDiscount(activeCoupon({ isActive: false }), 10000, 0, now), /inactive/);
  assert.throws(() => calculateCouponDiscount(activeCoupon({ usedCount: 100 }), 10000, 0, now), /usage limit/);
  assert.throws(() => calculateCouponDiscount(activeCoupon(), 10000, 1, now), /per-user/);
  assert.throws(() => calculateCouponDiscount(activeCoupon(), 999, 0, now), /minimum/);
});

test('order discount allocation preserves the exact total across sellers', () => {
  const items = allocateOrderDiscount([{ subtotal: 1000 }, { subtotal: 2000 }, { subtotal: 3000 }], 1001);
  assert.deepEqual(items.map((item) => item.discountAmount), [166, 333, 502]);
  assert.equal(items.reduce((sum, item) => sum + item.discountAmount, 0), 1001);
});
