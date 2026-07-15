const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentApprovalUseCase } = require('../dist/application/use-cases/agent-approval.use-case');

const profile = {
  id: 'agent-1', userId: 'user-1', businessName: 'Shop', commissionRate: 5,
  approvalStatus: 'PENDING',
};

test('approved agent replay republishes without rewriting state', async () => {
  const events = [];
  const useCase = new AgentApprovalUseCase({
    findById: async () => ({ ...profile, approvalStatus: 'APPROVED', approvedBy: 'admin-1' }),
    updateApprovalStatus: async () => assert.fail('must not rewrite'),
  }, { send: async (...args) => events.push(args) });
  await useCase.approve(profile.id, 'admin-1', { commissionRate: 5 });
  assert.equal(events[0][0], 'agent.approved');
});

test('terminal agent approval transitions cannot be overwritten', async () => {
  const producer = { send: async () => assert.fail('must not publish') };
  const approveRejected = new AgentApprovalUseCase({
    findById: async () => ({ ...profile, approvalStatus: 'REJECTED' }),
  }, producer);
  await assert.rejects(approveRejected.approve(profile.id, 'admin-1', {}), /Cannot approve/);

  const rejectApproved = new AgentApprovalUseCase({
    findById: async () => ({ ...profile, approvalStatus: 'APPROVED' }),
  }, producer);
  await assert.rejects(rejectApproved.reject(profile.id, 'admin-1', { reason: 'No' }), /Cannot reject/);
});
