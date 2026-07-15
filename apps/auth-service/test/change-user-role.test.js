const test = require('node:test');
const assert = require('node:assert/strict');
const { UserRole } = require('@ecommerce/shared');
const { ChangeUserRoleUseCase } = require('../dist/application/use-cases/change-user-role.use-case');

test('super-admin role change updates the user, revokes sessions, and publishes synchronization', async () => {
  const writes = [];
  const events = [];
  const useCase = new ChangeUserRoleUseCase({
    findById: async () => ({ id: 'user-1', role: UserRole.USER }),
    updateRole: async (id, role) => { writes.push([id, role]); return { id, role }; },
  }, {
    deleteByUserId: async (id) => writes.push(['revoke', id]),
  }, {
    send: async (...args) => events.push(args),
  });

  await useCase.execute('user-1', UserRole.ADMIN, 'super-1');
  assert.deepEqual(writes, [['user-1', UserRole.ADMIN], ['revoke', 'user-1']]);
  assert.equal(events[0][0], 'user.role.changed');
  assert.equal(events[0][1].payload.role, UserRole.ADMIN);
});

test('exact role-change retry only republishes the event', async () => {
  const events = [];
  const revoked = [];
  const useCase = new ChangeUserRoleUseCase({
    findById: async () => ({ id: 'user-1', role: UserRole.ADMIN }),
    updateRole: async () => assert.fail('must not rewrite'),
  }, {
    deleteByUserId: async (id) => revoked.push(id),
  }, { send: async (...args) => events.push(args) });

  await useCase.execute('user-1', UserRole.ADMIN, 'super-1');
  assert.deepEqual(revoked, ['user-1']);
  assert.equal(events.length, 1);
});

test('agent and seeded super-admin roles cannot be changed directly', async () => {
  for (const role of [UserRole.AGENT, UserRole.SUPER_ADMIN]) {
    const useCase = new ChangeUserRoleUseCase({ findById: async () => ({ id: 'user-1', role }) }, {}, {});
    await assert.rejects(useCase.execute('user-1', UserRole.USER, 'super-1'));
  }
});
