const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Permission, getPermissions, hasPermission, requireAuth, requireRole,
  requireApprovedAgent, requirePermission, requireOwnership, requireAgentOwnership,
} = require('../dist');

const roles = { SUPER_ADMIN: 'super-admin', ADMIN: 'admin', AGENT: 'agent', USER: 'user' };
const request = (role, extra = {}) => ({ user: role ? { id: 'user-1', email: 'a@example.com', role, ...extra } : undefined });
const run = async (middleware, req) => {
  let result = 'not-called';
  await middleware(req, {}, (error) => { result = error ?? null; });
  return result;
};

test('super-admin receives every permission while privileged operations remain exclusive', () => {
  const all = Object.values(Permission);
  assert.deepEqual(new Set(getPermissions(roles.SUPER_ADMIN)), new Set(all));
  for (const permission of [Permission.CREATE_ADMIN, Permission.CHANGE_USER_ROLE, Permission.READ_AUDIT_LOG, Permission.SET_COMMISSION, Permission.MANAGE_SETTLEMENTS]) {
    assert.equal(hasPermission(roles.SUPER_ADMIN, permission), true);
    assert.equal(hasPermission(roles.ADMIN, permission), false);
    assert.equal(hasPermission(roles.AGENT, permission), false);
    assert.equal(hasPermission(roles.USER, permission), false);
  }
});

test('role permission boundaries match customer, seller, and admin responsibilities', () => {
  assert.equal(hasPermission(roles.USER, Permission.MANAGE_OWN_CART), true);
  assert.equal(hasPermission(roles.USER, Permission.UPDATE_OWN_INVENTORY), false);
  assert.equal(hasPermission(roles.AGENT, Permission.UPDATE_OWN_INVENTORY), true);
  assert.equal(hasPermission(roles.AGENT, Permission.READ_ALL_INVENTORY), false);
  assert.equal(hasPermission(roles.ADMIN, Permission.READ_ALL_INVENTORY), true);
  assert.equal(hasPermission(roles.ADMIN, Permission.DELETE_ANY_PRODUCT), true);
  assert.equal(hasPermission(roles.AGENT, Permission.DELETE_ANY_PRODUCT), false);
  assert.equal(hasPermission(roles.ADMIN, Permission.CREATE_PRODUCT), false);
});

test('returned permission lists cannot mutate the process-wide role matrix', () => {
  const permissions = getPermissions(roles.USER);
  permissions.push(Permission.CREATE_ADMIN);
  assert.equal(hasPermission(roles.USER, Permission.CREATE_ADMIN), false);
});

test('authentication, role, permission, and approved-agent guards distinguish 401 and 403', async () => {
  assert.equal((await run(requireAuth, request())).statusCode, 401);
  assert.equal(await run(requireAuth, request(roles.USER)), null);
  assert.equal((await run(requireRole(roles.ADMIN), request(roles.USER))).statusCode, 403);
  assert.equal(await run(requireRole(roles.ADMIN), request(roles.ADMIN)), null);
  assert.equal((await run(requirePermission(Permission.READ_ALL_USERS), request(roles.USER))).statusCode, 403);
  assert.equal(await run(requirePermission(Permission.READ_ALL_USERS), request(roles.ADMIN)), null);
  assert.equal((await run(requireApprovedAgent, request(roles.AGENT))).statusCode, 403);
  assert.equal(await run(requireApprovedAgent, request(roles.AGENT, { agentId: 'agent-1' })), null);
});

test('resource ownership allows owners and admins but rejects other customers', async () => {
  const own = requireOwnership(async () => 'user-1');
  const other = requireOwnership(async () => 'user-2');
  assert.equal(await run(own, request(roles.USER)), null);
  assert.equal((await run(other, request(roles.USER))).statusCode, 403);
  assert.equal(await run(other, request(roles.ADMIN)), null);
});

test('agent ownership compares the agent claim and rejects customer roles', async () => {
  const owned = requireAgentOwnership(async () => 'agent-1');
  const foreign = requireAgentOwnership(async () => 'agent-2');
  assert.equal(await run(owned, request(roles.AGENT, { agentId: 'agent-1' })), null);
  assert.equal((await run(foreign, request(roles.AGENT, { agentId: 'agent-1' }))).statusCode, 403);
  assert.equal((await run(owned, request(roles.USER))).statusCode, 403);
  assert.equal(await run(foreign, request(roles.SUPER_ADMIN)), null);
});
