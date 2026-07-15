import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiResponse } from '../src/lib/api-response.mjs';

test('unwraps a normal success envelope', () => {
  assert.deepEqual(normalizeApiResponse({ data: { id: 'user-1', role: 'admin' } }), {
    id: 'user-1', role: 'admin',
  });
});

test('flattens shared paginated envelopes without dropping endpoint metadata', () => {
  assert.deepEqual(normalizeApiResponse({
    data: {
      data: [{ id: 'product-1' }],
      meta: { total: 21, page: 2, limit: 10, totalPages: 3, hasNextPage: true },
      statusSummary: [{ status: 'ACTIVE', count: '21' }],
    },
  }), {
    items: [{ id: 'product-1' }],
    total: 21,
    page: 2,
    limit: 10,
    totalPages: 3,
    hasNextPage: true,
    statusSummary: [{ status: 'ACTIVE', count: '21' }],
  });
});

test('preserves unwrapped legacy payloads and empty responses', () => {
  assert.deepEqual(normalizeApiResponse({ value: 1 }), { value: 1 });
  assert.deepEqual(normalizeApiResponse({}), {});
});
