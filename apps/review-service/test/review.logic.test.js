const test = require('node:test');
const assert = require('node:assert/strict');
const { ratingSummary } = require('../dist/review.logic');
const { drainRatingOutbox, normalizeRatingSummary, queueRatingProjection } = require('../dist/rating-outbox');

test('returns an empty absolute rating summary', () => {
  assert.deepEqual(ratingSummary([]), { average: 0, count: 0 });
});

test('calculates and rounds an absolute rating summary', () => {
  assert.deepEqual(ratingSummary([{ rating: 5 }, { rating: 4 }, { rating: 3 }]), { average: 4, count: 3 });
  assert.deepEqual(ratingSummary([{ rating: 5 }, { rating: 4 }, { rating: 4 }]), { average: 4.33, count: 3 });
});

test('normalizes PostgreSQL aggregate values for the rating event', () => {
  assert.deepEqual(normalizeRatingSummary('product-1', '4.333333', '3'), {
    productId: 'product-1', average: 4.33, count: 3,
  });
  assert.deepEqual(normalizeRatingSummary('product-2', null, '0'), {
    productId: 'product-2', average: 0, count: 0,
  });
});

test('queues one replaceable projection request per product', async () => {
  const calls = [];
  const client = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } };
  const eventId = await queueRatingProjection(client, '11111111-1111-4111-8111-111111111111');
  assert.match(eventId, /^[0-9a-f-]{36}$/);
  assert.match(calls[0].sql, /ON CONFLICT \(product_id\) DO UPDATE/);
  assert.deepEqual(calls[0].values, ['11111111-1111-4111-8111-111111111111', eventId]);
});

test('dispatches an outbox row with its stable event ID before committing deletion', async () => {
  const statements = [];
  const client = {
    query: async (sql, values) => {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.includes('FROM review_rating_outbox')) return { rows: [{ productId: 'product-1', eventId: 'event-1' }], rowCount: 1 };
      if (sql.includes('AVG(rating)')) return { rows: [{ average: '4.5', count: '2' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
    release: () => statements.push('RELEASE'),
  };
  const published = [];
  const count = await drainRatingOutbox({ connect: async () => client }, async (projection, eventId) => published.push({ projection, eventId }));
  assert.equal(count, 1);
  assert.deepEqual(published, [{ projection: { productId: 'product-1', average: 4.5, count: 2 }, eventId: 'event-1' }]);
  assert.ok(statements.some((sql) => sql.startsWith('DELETE FROM review_rating_outbox')));
  assert.equal(statements.at(-2), 'COMMIT');
  assert.equal(statements.at(-1), 'RELEASE');
});

test('keeps the outbox row pending when publication fails', async () => {
  const statements = [];
  const client = {
    query: async (sql) => {
      statements.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.includes('FROM review_rating_outbox')) return { rows: [{ productId: 'product-1', eventId: 'event-1' }], rowCount: 1 };
      if (sql.includes('AVG(rating)')) return { rows: [{ average: '5', count: '1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release: () => statements.push('RELEASE'),
  };
  await assert.rejects(
    drainRatingOutbox({ connect: async () => client }, async () => { throw new Error('Kafka unavailable'); }),
    /Kafka unavailable/,
  );
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(!statements.some((sql) => sql.startsWith('DELETE FROM review_rating_outbox')));
  assert.equal(statements.at(-1), 'RELEASE');
});
