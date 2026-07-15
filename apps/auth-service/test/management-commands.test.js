const test = require('node:test');
const assert = require('node:assert/strict');
const { ManageUserStatusUseCase } = require('../dist/application/use-cases/manage-user-status.use-case');
const { UpdateCommissionUseCase } = require('../dist/application/use-cases/update-commission.use-case');

const transaction = async (work) => work({});

test('user deactivation is owned by auth and revokes sessions before publishing synchronization', async () => {
  const calls = [];
  const updatedAt = new Date('2026-07-15T00:00:00Z');
  const users = {
    findByIdForUpdate: async () => ({ id: 'user-1', role: 'user', isActive: true, updatedAt: new Date('2026-01-01') }),
    updateActiveStatus: async (...args) => { calls.push(['update', ...args]); return updatedAt; },
  };
  const tokens = { deleteByUserId: async (...args) => calls.push(['revoke', ...args]) };
  const producer = { send: async (...args) => calls.push(['publish', ...args]) };
  const result = await new ManageUserStatusUseCase(users, tokens, producer, transaction)
    .execute('user-1', false, 'admin-1', 'admin');

  assert.equal(result.previousIsActive, true);
  assert.deepEqual(calls.map((call) => call[0]), ['update', 'revoke', 'publish']);
  assert.equal(calls[2][1], 'user.status.changed');
  assert.equal(calls[2][4], `user-status:user-1:false:${updatedAt.toISOString()}`);
});

test('user status command protects privileged accounts and self-deactivation', async () => {
  const producer = { send: async () => {} };
  const tokens = { deleteByUserId: async () => {} };
  const adminUsers = { findByIdForUpdate: async () => ({ id: 'admin-2', role: 'admin', isActive: true, updatedAt: new Date() }) };
  await assert.rejects(
    new ManageUserStatusUseCase(adminUsers, tokens, producer, transaction).execute('admin-2', false, 'admin-1', 'admin'),
    /super-admin/,
  );
  const normalUsers = { findByIdForUpdate: async () => ({ id: 'user-1', role: 'user', isActive: true, updatedAt: new Date() }) };
  await assert.rejects(
    new ManageUserStatusUseCase(normalUsers, tokens, producer, transaction).execute('user-1', false, 'user-1', 'admin'),
    /own account/,
  );
});

test('commission command is super-admin-only and replay-safe', async () => {
  let writes = 0;
  const agents = {
    findByIdForUpdate: async () => ({ id: 'agent-1', commissionRate: 7.5 }),
    setCommissionRate: async () => { writes += 1; },
  };
  const useCase = new UpdateCommissionUseCase(agents, transaction);
  const replay = await useCase.execute('agent-1', 7.5, 'super-admin');
  assert.equal(replay.previousCommissionRate, 7.5);
  assert.equal(writes, 0);
  await assert.rejects(useCase.execute('agent-1', 8, 'admin'), /super-admin/);
});
