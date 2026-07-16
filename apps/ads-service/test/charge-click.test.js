const test = require('node:test');
const assert = require('node:assert/strict');
const { chargeClick } = require('../dist/application/charge-click');

const base = {
  costPerClick: 500,
  dailyBudget: 2000,
  totalBudget: 10000,
  spentTotal: 0,
  spentToday: 0,
  spendDate: '2026-07-15',
};

test('charges a click and advances both spend counters when budget remains', () => {
  const result = chargeClick(base, '2026-07-15');
  assert.equal(result.charged, true);
  assert.equal(result.clickCountDelta, 1);
  assert.equal(result.spentTotal, 500);
  assert.equal(result.spentToday, 500);
  assert.equal(result.newStatus, 'ACTIVE');
});

test('resets spent-today to zero before charging when the day has rolled over', () => {
  const campaign = { ...base, spentToday: 1800, spendDate: '2026-07-14' };
  const result = chargeClick(campaign, '2026-07-15');
  assert.equal(result.charged, true);
  assert.equal(result.spentToday, 500); // reset to 0, then charged once
  assert.equal(result.spendDate, '2026-07-15');
});

test('rejects the click once the daily budget is exhausted, without touching total spend', () => {
  const campaign = { ...base, spentToday: 2000, spentTotal: 4000 };
  const result = chargeClick(campaign, '2026-07-15');
  assert.equal(result.charged, false);
  assert.equal(result.clickCountDelta, 0);
  assert.equal(result.spentTotal, 4000);
  assert.equal(result.newStatus, 'ACTIVE');
});

test('rejects the click once the total budget is exhausted and reports COMPLETED', () => {
  const campaign = { ...base, spentTotal: 10000 };
  const result = chargeClick(campaign, '2026-07-15');
  assert.equal(result.charged, false);
  assert.equal(result.newStatus, 'COMPLETED');
});

test('transitions to COMPLETED the moment a charge exhausts the total budget', () => {
  const campaign = { ...base, spentTotal: 9600 };
  const result = chargeClick(campaign, '2026-07-15');
  assert.equal(result.charged, true);
  assert.equal(result.spentTotal, 10100);
  assert.equal(result.newStatus, 'COMPLETED');
});
