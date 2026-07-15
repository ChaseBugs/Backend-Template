const test = require('node:test');
const assert = require('node:assert/strict');
const { CreateOrderUseCase } = require('../dist/application/use-cases/create-order.use-case');

const address = {
  recipientName: 'Buyer', phone: '010', addressLine1: '1 Main St', city: 'Seoul', postalCode: '12345',
};
const persisted = {
  id: 'o1', sagaId: 's1', userId: 'u1', status: 'PENDING', shippingAddress: address,
  totalAmount: 1000, shippingFee: 3000, discountAmount: 0, finalAmount: 4000,
  idempotencyKey: 'key1', createdAt: new Date(), updatedAt: new Date(),
  items: [{ id: 'i1', orderId: 'o1', productId: 'p1', agentId: 'a1', productName: 'P', quantity: 1, unitPrice: 1000, subtotal: 1000, discountAmount: 0, shippingFee: 3000 }],
};

test('exact order retry returns persisted order and republishes without pricing dependencies', async () => {
  const sent = [];
  const repo = { findByIdempotencyKey: async () => persisted };
  const useCase = new CreateOrderUseCase(repo, { send: async (...args) => sent.push(args) });
  const result = await useCase.replayIfExists({ items: [{ productId: 'p1', quantity: 1 }], shippingAddress: address, idempotencyKey: 'key1' }, 'u1');
  assert.equal(result, persisted);
  assert.equal(sent[0][0], 'order.created');
  assert.equal(sent[0][1].payload.finalAmount, 4000);
});

test('changed order payload cannot reuse an idempotency key', async () => {
  const repo = { findByIdempotencyKey: async () => persisted };
  const useCase = new CreateOrderUseCase(repo, { send: async () => {} });
  await assert.rejects(
    useCase.replayIfExists({ items: [{ productId: 'p1', quantity: 2 }], shippingAddress: address, idempotencyKey: 'key1' }, 'u1'),
    /Idempotency key/,
  );
});

test('an idempotency key cannot be replayed with a different coupon', async () => {
  const repo = { findByIdempotencyKey: async () => ({ ...persisted, couponCode: 'WELCOME10' }) };
  const useCase = new CreateOrderUseCase(repo, { send: async () => {} });
  await assert.rejects(
    useCase.replayIfExists({ items: [{ productId: 'p1', quantity: 1 }], shippingAddress: address, couponCode: 'OTHER', idempotencyKey: 'key1' }, 'u1'),
    /Idempotency key/,
  );
});
