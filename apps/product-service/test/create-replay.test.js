const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductUseCases } = require('../dist/application/use-cases/product.use-cases');

const dto = {
  categoryId: 'category-1',
  name: 'Product',
  description: 'Description',
  price: 1200,
  comparePrice: 1500,
  brand: 'Brand',
  tags: ['tag'],
  images: ['https://example.com/image.png'],
  sku: 'SELLER-SKU-1',
  condition: 'NEW',
};

const product = {
  id: 'product-1',
  catalogVariantId: 'variant-1',
  agentId: 'agent-1',
  ...dto,
  status: 'PENDING_APPROVAL',
  viewCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

test('exact product creation retry returns the original id and republishes the event', async () => {
  const events = [];
  const useCases = new ProductUseCases(
    { findByIdempotencyKey: async () => product },
    {},
    { send: async (...args) => events.push(args) },
  );

  const result = await useCases.create(dto, 'agent-1', 'request-1');
  assert.equal(result.id, product.id);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'product.created');
  assert.equal(events[0][1].payload.productId, product.id);
});

test('product idempotency key cannot be reused for different input', async () => {
  const useCases = new ProductUseCases(
    { findByIdempotencyKey: async () => product },
    {},
    { send: async () => assert.fail('must not publish') },
  );

  await assert.rejects(useCases.create({ ...dto, price: 999 }, 'agent-1', 'request-1'), /Idempotency key/);
});

test('concurrent unique-key loser reloads and replays the winning product', async () => {
  let lookup = 0;
  const events = [];
  const useCases = new ProductUseCases(
    {
      findByIdempotencyKey: async () => (++lookup === 1 ? null : product),
      create: async () => { const error = new Error('duplicate'); error.code = '23505'; throw error; },
    },
    {},
    { send: async (...args) => events.push(args) },
  );

  const result = await useCases.create(dto, 'agent-1', 'request-1');
  assert.equal(result.id, product.id);
  assert.equal(lookup, 2);
  assert.equal(events.length, 1);
});

test('approval replay republishes an active product without rewriting it', async () => {
  const events = [];
  const active = { ...product, status: 'ACTIVE' };
  const useCases = new ProductUseCases(
    {
      findById: async () => active,
      approve: async () => assert.fail('must not repeat approval write'),
    },
    { invalidateCache: async () => assert.fail('must not invalidate unchanged data') },
    { send: async (...args) => events.push(args) },
  );

  await useCases.approve(product.id, 'admin-1');
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'product.approved');
});

test('invalid product lifecycle transition is rejected before writing', async () => {
  const useCases = new ProductUseCases(
    {
      findById: async () => ({ ...product, status: 'INACTIVE' }),
      approve: async () => assert.fail('must not approve an inactive product'),
    },
    {},
    { send: async () => assert.fail('must not publish') },
  );

  await assert.rejects(useCases.approve(product.id, 'admin-1'), /Cannot approve/);
});

test('administrator deletion bypasses ownership but publishes the original owner', async () => {
  const events = [];
  const invalidated = [];
  const useCases = new ProductUseCases(
    { findById: async () => ({ ...product, status: 'ACTIVE' }), softDeleteAny: async () => true },
    { invalidateCache: async (id) => invalidated.push(id) },
    { send: async (...args) => events.push(args) },
  );

  await useCases.deleteAny(product.id);
  assert.deepEqual(invalidated, [product.id]);
  assert.equal(events[0][0], 'product.deleted');
  assert.equal(events[0][1].payload.agentId, product.agentId);
});

test('agent deletion cannot delete another agent product', async () => {
  const useCases = new ProductUseCases(
    { findById: async () => ({ ...product, status: 'ACTIVE' }), softDelete: async () => assert.fail('must not write') },
    { invalidateCache: async () => assert.fail('must not invalidate') },
    { send: async () => assert.fail('must not publish') },
  );

  await assert.rejects(useCases.delete(product.id, 'agent-2'), /do not own/);
});

test('inactive deletion replay repairs cache and event publication without another write', async () => {
  const events = [];
  const useCases = new ProductUseCases(
    { findById: async () => ({ ...product, status: 'INACTIVE' }), softDeleteAny: async () => assert.fail('must not rewrite') },
    { invalidateCache: async () => {} },
    { send: async (...args) => events.push(args) },
  );

  await useCases.deleteAny(product.id);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], 'product.deleted');
});
