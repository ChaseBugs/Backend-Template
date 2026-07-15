const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const baseUrl = (process.env.INTEGRATION_OPENSEARCH_URL ?? 'http://localhost:9200').replace(/\/$/, '');
const index = process.env.INTEGRATION_OPENSEARCH_PRODUCTS_INDEX ?? 'products';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}/${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenSearch ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

test('OpenSearch products index has nori mappings and serves a refreshed document', { timeout: 20000 }, async () => {
  const productId = randomUUID();
  const mapping = await request(`${index}/_mapping`);
  const properties = mapping[index]?.mappings?.properties;
  assert.equal(properties?.name?.analyzer, 'korean_analyzer');
  assert.equal(properties?.productId?.type, 'keyword');
  assert.equal(properties?.ratingAverage?.type, 'float');

  try {
    await request(`${index}/_doc/${productId}?refresh=wait_for`, {
      method: 'PUT',
      body: JSON.stringify({
        productId,
        agentId: randomUUID(),
        categoryId: randomUUID(),
        name: '통합 테스트 상품',
        description: '한국어 형태소 검색 검증',
        price: 1000,
        status: 'ACTIVE',
        inStock: true,
        ratingAverage: 4.5,
        ratingCount: 2,
      }),
    });
    const result = await request(`${index}/_search`, {
      method: 'POST',
      body: JSON.stringify({
        query: { bool: { must: [{ match: { name: '통합 테스트' } }], filter: [{ term: { productId } }] } },
      }),
    });
    assert.equal(result.hits.total.value, 1);
    assert.equal(result.hits.hits[0]._source.productId, productId);
  } finally {
    await request(`${index}/_doc/${productId}?refresh=wait_for`, { method: 'DELETE' }).catch(() => undefined);
  }
});
