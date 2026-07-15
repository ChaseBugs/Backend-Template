const test = require('node:test');
const assert = require('node:assert/strict');
const { LogoutUseCase } = require('../dist/application/use-cases/logout.use-case');

const tokenService = {
  verifyRefreshToken: () => ({ sub: 'user-1', jti: 'token-1' }),
  hashToken: () => 'token-hash',
};

test('logout revokes the authenticated user refresh token', async () => {
  const deleted = [];
  const useCase = new LogoutUseCase({
    findByHash: async () => ({ id: 'token-1', userId: 'user-1' }),
    deleteById: async (id) => deleted.push(id),
  }, tokenService);

  await useCase.execute('refresh-token', 'user-1');
  assert.deepEqual(deleted, ['token-1']);
});

test('logout is idempotent when the refresh token is already revoked', async () => {
  const useCase = new LogoutUseCase({
    findByHash: async () => null,
    deleteById: async () => assert.fail('must not delete twice'),
  }, tokenService);

  await useCase.execute('refresh-token', 'user-1');
});

test('logout cannot revoke another user token', async () => {
  const useCase = new LogoutUseCase({
    findByHash: async () => assert.fail('must reject before lookup'),
  }, tokenService);

  await assert.rejects(useCase.execute('refresh-token', 'user-2'), /does not belong/);
});
