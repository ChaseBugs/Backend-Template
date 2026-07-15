const test = require('node:test');
const assert = require('node:assert/strict');
const { UpdateProductSchema } = require('../dist/application/dtos/product.dto');

test('product updates require at least one validated field', () => {
  assert.equal(UpdateProductSchema.safeParse({}).success, false);
  assert.equal(UpdateProductSchema.safeParse({ unknown: 'value' }).success, false);
  assert.equal(UpdateProductSchema.safeParse({ name: 'Updated product' }).success, true);
});
