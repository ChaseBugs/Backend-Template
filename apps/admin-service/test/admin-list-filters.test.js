const test = require('node:test');
const assert = require('node:assert/strict');
const { buildUserListFilter, buildOrderListFilter } = require('../dist/admin-list-filters');

test('user filters are parameterized and cover search, role, and active state', () => {
  const filter = buildUserListFilter({ search: "a%' OR true --", role: 'agent', isActive: 'false' }, 3);
  assert.deepEqual(filter.params, ["%a\\%' OR true --%", 'agent', false]);
  assert.match(filter.where, /ILIKE \$3/);
  assert.match(filter.where, /u\.role = \$4/);
  assert.match(filter.where, /u\.is_active = \$5/);
  assert.doesNotMatch(filter.where, /OR true/);
});

test('order filters cover status, agent, and inclusive calendar date range', () => {
  const agentId = '1c7a71a7-4fd1-4a0f-9f5f-bd310fcedf40';
  const filter = buildOrderListFilter({ status: 'PAID', agentId, dateFrom: '2026-01-01', dateTo: '2026-01-31' });
  assert.deepEqual(filter.params, ['PAID', agentId, '2026-01-01', '2026-01-31']);
  assert.match(filter.where, /o\.status = \$1/);
  assert.match(filter.where, /EXISTS/);
  assert.match(filter.where, /INTERVAL '1 day'/);
});

test('invalid list filters fail before database access', () => {
  assert.throws(() => buildUserListFilter({ role: 'owner' }), /Invalid user role/);
  assert.throws(() => buildOrderListFilter({ status: 'CONFIRMED' }), /Invalid order status/);
  assert.throws(() => buildOrderListFilter({ agentId: 'not-a-uuid' }), /agentId must be a UUID/);
  assert.throws(() => buildOrderListFilter({ dateFrom: '2026-02-02', dateTo: '2026-02-01' }), /dateFrom/);
  assert.throws(() => buildOrderListFilter({ dateFrom: '2026-02-30' }), /YYYY-MM-DD/);
});
