const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { authenticate } = require('../dist/middleware/authenticate');

function run(headers) {
  const req = { headers: { ...headers } };
  let called = false;
  authenticate(req, {}, () => { called = true; });
  assert.equal(called, true);
  return req;
}

test('removes forged identity headers from anonymous requests', () => {
  const req = run({
    'x-user-id': 'attacker',
    'x-user-role': 'super-admin',
    'x-user-email': 'attacker@example.com',
    'x-agent-id': 'forged-agent',
  });

  assert.equal(req.user, undefined);
  assert.equal(req.headers['x-user-id'], undefined);
  assert.equal(req.headers['x-user-role'], undefined);
  assert.equal(req.headers['x-user-email'], undefined);
  assert.equal(req.headers['x-agent-id'], undefined);
});

test('replaces forged headers with verified JWT claims', () => {
  const token = jwt.sign(
    { email: 'agent@example.com', role: 'agent', agentId: 'real-agent' },
    'dev-secret-change-in-production',
    { subject: 'real-user', issuer: 'ecommerce-auth', audience: 'ecommerce-api' },
  );
  const req = run({
    authorization: `Bearer ${token}`,
    'x-user-id': 'attacker',
    'x-user-role': 'super-admin',
  });

  assert.equal(req.user.id, 'real-user');
  assert.equal(req.headers['x-user-id'], 'real-user');
  assert.equal(req.headers['x-user-role'], 'agent');
  assert.equal(req.headers['x-agent-id'], 'real-agent');
});

test('invalid JWTs cannot preserve forged identity headers', () => {
  const req = run({
    authorization: 'Bearer invalid-token',
    'x-user-id': 'attacker',
    'x-user-role': 'admin',
  });

  assert.equal(req.user, undefined);
  assert.equal(req.headers['x-user-id'], undefined);
  assert.equal(req.headers['x-user-role'], undefined);
});
