const test = require('node:test');
const assert = require('node:assert/strict');
const { DeliveryUseCases } = require('../dist/application/use-cases/delivery.use-cases');

test('counts agent throughput only when a new delivery group is created', async () => {
  const counted = [];
  const sent = [];
  let invocation = 0;
  const repository = {
    createGroup: async (group) => ({
      group: { ...group, createdAt: new Date(), updatedAt: new Date() },
      created: invocation++ === 0,
    }),
  };
  const useCases = new DeliveryUseCases(
    repository,
    { send: async (...args) => sent.push(args) },
    { info() {}, warn() {}, error() {} },
    { recordAgentOrder: (agentId) => counted.push(agentId) },
    async (work) => work({}),
  );
  const input = {
    orderId: 'order-1', userId: 'user-1', paymentId: 'payment-1',
    items: [{ productId: 'product-1', agentId: 'agent-1', quantity: 1, shippingFee: 3000 }],
  };

  await useCases.createGroupsForOrder(input);
  await useCases.createGroupsForOrder(input);
  assert.deepEqual(counted, ['agent-1']);
  assert.equal(sent.length, 2);
});
