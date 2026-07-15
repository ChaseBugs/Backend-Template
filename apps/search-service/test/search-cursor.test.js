const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeSearchCursor, encodeSearchCursor, escapeRedisGlob } = require('../dist/search-cursor');

test('search cursor round-trips OpenSearch sort values', () => {
  const encoded = encodeSearchCursor([1.25, 'product-1']);
  assert.deepEqual(decodeSearchCursor(encoded), [1.25, 'product-1']);
  assert.equal(encodeSearchCursor([]), null);
});

test('rejects malformed cursors and escapes Redis glob input', () => {
  assert.throws(() => decodeSearchCursor('not-base64-json'), /Invalid search cursor/);
  assert.equal(escapeRedisGlob('a*[b]?'), 'a\\*\\[b\\]\\?');
});
