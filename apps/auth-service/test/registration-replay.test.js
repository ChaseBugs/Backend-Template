const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { UserRole } = require('@ecommerce/shared');
const { RegisterUseCase } = require('../dist/application/use-cases/register.use-case');
const { CreateAdminUseCase } = require('../dist/application/use-cases/create-admin.use-case');

const existingUser = async (role = UserRole.USER) => ({
  id: 'user-1',
  email: 'user@example.com',
  passwordHash: await bcrypt.hash('password123', 4),
  role,
  firstName: 'Test',
  lastName: 'User',
  phone: undefined,
});

test('exact registration retry creates a session and republishes USER_REGISTERED', async () => {
  const user = await existingUser();
  const refreshTokens = [];
  const events = [];
  const useCase = new RegisterUseCase(
    { findByEmail: async () => user },
    { findByUserId: async () => null },
    { create: async (token) => refreshTokens.push(token) },
    {
      signRefreshToken: ({ jti }) => `refresh-${jti}`,
      hashToken: (token) => `hash-${token}`,
      getRefreshExpiryDate: () => new Date('2030-01-01T00:00:00Z'),
      signAccessToken: ({ sub }) => `access-${sub}`,
    },
    { send: async (...args) => events.push(args) },
  );

  const result = await useCase.execute({
    email: user.email,
    password: 'password123',
    firstName: user.firstName,
    lastName: user.lastName,
    role: UserRole.USER,
  });

  assert.equal(result.accessToken, 'access-user-1');
  assert.equal(refreshTokens.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'user.registered');
  assert.equal(events[0][1].payload.userId, user.id);
});

test('registration retry with changed identity is rejected', async () => {
  const user = await existingUser();
  const useCase = new RegisterUseCase(
    { findByEmail: async () => user },
    { findByUserId: async () => null },
    { create: async () => assert.fail('must not create a token') },
    {},
    { send: async () => assert.fail('must not publish') },
  );

  await assert.rejects(
    useCase.execute({ email: user.email, password: 'password123', firstName: 'Changed', lastName: user.lastName, role: UserRole.USER }),
    /Email already registered/,
  );
});

test('exact admin creation retry republishes the registration event', async () => {
  const user = await existingUser(UserRole.ADMIN);
  const events = [];
  const useCase = new CreateAdminUseCase(
    { findByEmail: async () => user },
    { send: async (...args) => events.push(args) },
  );

  const result = await useCase.execute({
    email: user.email,
    password: 'password123',
    firstName: user.firstName,
    lastName: user.lastName,
    role: UserRole.ADMIN,
  });
  assert.equal(result.id, user.id);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'user.registered');
});

test('pending agent registration retry does not receive an approved agent claim', async () => {
  const user = await existingUser(UserRole.AGENT);
  let accessPayload;
  const useCase = new RegisterUseCase(
    { findByEmail: async () => user },
    { findByUserId: async () => ({ id: 'agent-1', approvalStatus: 'PENDING', businessName: 'Shop', businessNumber: 'BN-1' }) },
    { create: async () => {} },
    {
      signRefreshToken: () => 'refresh', hashToken: () => 'hash', getRefreshExpiryDate: () => new Date(),
      signAccessToken: (payload) => { accessPayload = payload; return 'access'; },
    },
    { send: async () => {} },
  );

  await useCase.execute({
    email: user.email, password: 'password123', firstName: user.firstName, lastName: user.lastName,
    role: UserRole.AGENT, businessName: 'Shop', businessNumber: 'BN-1',
  });
  assert.equal(accessPayload.agentId, undefined);
});

test('pending agent registration publishes a deterministic administrator application event', async () => {
  const user = await existingUser(UserRole.AGENT);
  const events = [];
  const useCase = new RegisterUseCase(
    { findByEmail: async () => user },
    { findByUserId: async () => ({ id: 'agent-1', userId: user.id, approvalStatus: 'PENDING', businessName: 'Shop', businessNumber: 'BN-1' }) },
    { create: async () => {} },
    {
      signRefreshToken: () => 'refresh', hashToken: () => 'hash', getRefreshExpiryDate: () => new Date(),
      signAccessToken: () => 'access',
    },
    { send: async (...args) => events.push(args) },
  );

  await useCase.execute({
    email: user.email, password: 'password123', firstName: user.firstName, lastName: user.lastName,
    role: UserRole.AGENT, businessName: 'Shop', businessNumber: 'BN-1',
  });

  assert.equal(events.length, 2);
  assert.equal(events[1][0], 'agent.application.submitted');
  assert.equal(events[1][1].payload.agentId, 'agent-1');
  assert.equal(events[1][2], 'agent-1');
  assert.equal(events[1][3], 'agent-1');
});
