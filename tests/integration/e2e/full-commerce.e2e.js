const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

const baseUrl = (process.env.E2E_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const timeoutMs = positiveInteger('E2E_TIMEOUT_MS', 120_000);
const pollIntervalMs = positiveInteger('E2E_POLL_INTERVAL_MS', 500);

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function items(body) {
  const value = body?.data;
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function field(value, camel, snake = camel) {
  return value?.[camel] ?? value?.[snake];
}

async function request(path, { token, method = 'GET', body, headers = {}, expected = [200] } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  assert.ok(expected.includes(response.status), `${method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function poll(label, operation, predicate) {
  const deadline = Date.now() + timeoutMs;
  let last;
  let lastError;
  while (Date.now() < deadline) {
    try {
      last = await operation();
      if (predicate(last)) return last;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}${lastError ? `; error=${lastError.message}` : ''}`);
}

async function allPages(path, token) {
  const separator = path.includes('?') ? '&' : '?';
  const collected = [];
  for (let page = 1; ; page += 1) {
    const body = await request(`${path}${separator}page=${page}&limit=100`, { token });
    collected.push(...items(body));
    if (!body.data?.meta?.hasNextPage) return collected;
  }
}

async function resolveCategoryId() {
  if (process.env.E2E_CATEGORY_ID) return process.env.E2E_CATEGORY_ID;
  const client = new Client({
    connectionString: process.env.INTEGRATION_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ecommerce',
    connectionTimeoutMillis: 3_000,
  });
  await client.connect();
  try {
    const result = await client.query('SELECT id FROM product.categories ORDER BY sort_order, created_at LIMIT 1');
    assert.ok(result.rows[0]?.id, 'No product category exists; seed one or set E2E_CATEGORY_ID');
    return result.rows[0].id;
  } finally {
    await client.end();
  }
}

test('agent approval through return and settlement adjustment', { timeout: timeoutMs + 30_000 }, async (t) => {
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  assert.ok(adminEmail && adminPassword, 'E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are required');

  const readyUrl = new URL(baseUrl);
  readyUrl.pathname = '/ready';
  const readyResponse = await fetch(readyUrl, { signal: AbortSignal.timeout(10_000) });
  const readiness = await readyResponse.json();
  assert.equal(readyResponse.status, 200, `API Gateway is not ready: ${JSON.stringify(readiness)}`);

  const categoryId = await resolveCategoryId();
  const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const password = `E2e!${randomUUID()}aA1`;
  const agentEmail = `e2e-agent-${runId}@example.test`;
  const buyerEmail = `e2e-buyer-${runId}@example.test`;

  const adminLogin = await request('/auth/login', {
    method: 'POST', body: { email: adminEmail, password: adminPassword },
  });
  const adminToken = adminLogin.data?.accessToken;
  assert.ok(adminToken, 'Admin login did not return an access token');
  assert.equal(adminLogin.data?.user?.role, 'super-admin', 'E2E administrator must have the super-admin role');

  const agentRegistration = await request('/auth/register', {
    method: 'POST', expected: [201], body: {
      email: agentEmail, password, firstName: 'E2E', lastName: 'Agent', role: 'agent',
      businessName: `E2E Store ${runId}`, businessNumber: `E2E-${runId}`,
    },
  });
  const agentUserId = agentRegistration.data?.user?.id;
  assert.ok(agentUserId);

  const pending = await poll(
    'agent application',
    () => allPages('/agents/pending', adminToken),
    (agents) => agents.some((agent) => field(agent, 'userId', 'user_id') === agentUserId),
  );
  const agentProfile = pending.find((agent) => field(agent, 'userId', 'user_id') === agentUserId);
  const agentId = agentProfile.id;
  await request(`/agents/${agentId}/approve`, {
    token: adminToken, method: 'PATCH', body: { commissionRate: 12.5 },
  });

  const agentLogin = await request('/auth/login', {
    method: 'POST', body: { email: agentEmail, password },
  });
  const agentToken = agentLogin.data?.accessToken;
  assert.ok(agentToken);
  await request('/agents/shipping-policy', {
    token: agentToken, method: 'PUT', body: {
      baseShippingFee: 3000, freeShippingThreshold: 100_000, remoteAreaFee: 5000,
      supportedCouriers: ['E2E Courier'], defaultCourier: 'E2E Courier',
    },
  });

  const productResponse = await request('/products', {
    token: agentToken, method: 'POST', expected: [201],
    headers: { 'idempotency-key': `e2e-product:${runId}` },
    body: {
      categoryId, name: `E2E Product ${runId}`, description: 'Native full-flow integration product',
      price: 25_000, comparePrice: 30_000, brand: 'E2E', tags: ['e2e'], images: [],
    },
  });
  const productId = productResponse.data?.id;
  assert.ok(productId);
  await request(`/products/${productId}/approve`, { token: adminToken, method: 'PATCH', body: {} });
  await request(`/inventory/${productId}`, {
    token: agentToken, method: 'PUT', body: { quantity: 10 },
  });
  await poll('approved product read model', () => request(`/products/${productId}`), (body) => body.data?.id === productId);

  const buyerRegistration = await request('/auth/register', {
    method: 'POST', expected: [201], body: {
      email: buyerEmail, password, firstName: 'E2E', lastName: 'Buyer', role: 'user',
    },
  });
  const buyerToken = buyerRegistration.data?.accessToken;
  assert.ok(buyerToken);
  await request('/cart/items', {
    token: buyerToken, method: 'POST', body: { productId, quantity: 2 },
  });
  const cart = await request('/cart', { token: buyerToken });
  assert.equal(cart.data?.count, 1);
  assert.equal(cart.data?.total, 50_000);

  const orderResponse = await request('/orders', {
    token: buyerToken, method: 'POST', expected: [201], body: {
      items: [{ productId, quantity: 2 }], idempotencyKey: `e2e-order:${runId}`,
      shippingAddress: {
        recipientName: 'E2E Buyer', phone: '010-0000-0000', addressLine1: '1 Integration Road',
        city: 'Seoul', postalCode: '06234',
      },
    },
  });
  const orderId = orderResponse.data?.id;
  assert.ok(orderId);
  await poll(
    'inventory reservation',
    () => request(`/orders/${orderId}`, { token: buyerToken }),
    (body) => body.data?.status === 'PAYMENT_PENDING',
  );

  const paymentResponse = await request('/payments', {
    token: buyerToken, method: 'POST', expected: [201], body: {
      orderId, method: 'CARD', idempotencyKey: `e2e-payment:${runId}`,
    },
  });
  const paymentId = paymentResponse.data?.id;
  assert.ok(paymentId);
  assert.equal(paymentResponse.data?.status, 'COMPLETED');

  const deliveries = await poll(
    'delivery group creation',
    () => request(`/deliveries/order/${orderId}`, { token: buyerToken }),
    (body) => items(body).some((group) => field(group, 'agentId', 'agent_id') === agentId),
  );
  const delivery = items(deliveries).find((group) => field(group, 'agentId', 'agent_id') === agentId);
  const deliveryId = delivery.id;
  await request(`/deliveries/${deliveryId}/ship`, {
    token: agentToken, method: 'PATCH', body: { courierName: 'E2E Courier', trackingNumber: `TRACK-${runId}` },
  });
  await request(`/deliveries/${deliveryId}/confirm`, { token: buyerToken, method: 'POST', body: {} });
  await poll(
    'completed order projection',
    () => request(`/orders/${orderId}`, { token: buyerToken }),
    (body) => body.data?.status === 'COMPLETED',
  );

  const settlements = await poll(
    'agent settlement',
    () => request('/admin/settlements?limit=100', { token: adminToken }),
    (body) => items(body).some((settlement) => field(settlement, 'orderId', 'order_id') === orderId),
  );
  const settlement = items(settlements).find((value) => field(value, 'orderId', 'order_id') === orderId);
  await request(`/admin/settlements/${settlement.id}/status`, {
    token: adminToken, method: 'PATCH', body: { status: 'PROCESSING' },
  });
  await request(`/admin/settlements/${settlement.id}/status`, {
    token: adminToken, method: 'PATCH', body: { status: 'COMPLETED' },
  });

  await request(`/deliveries/${deliveryId}/return`, {
    token: buyerToken, method: 'POST', body: { reason: `E2E return ${runId}` },
  });
  await poll(
    'return refund completion',
    () => request(`/payments/${paymentId}`, { token: buyerToken }),
    (body) => Number(field(body.data, 'refundAmount', 'refund_amount') ?? 0) > 0,
  );
  const adjustments = await poll(
    'completed-settlement clawback adjustment',
    () => request('/admin/settlement-adjustments?limit=100', { token: adminToken }),
    (body) => items(body).some((adjustment) => field(adjustment, 'orderId', 'order_id') === orderId),
  );
  const adjustment = items(adjustments).find((value) => field(value, 'orderId', 'order_id') === orderId);
  assert.equal(field(adjustment, 'status'), 'PENDING');

  t.diagnostic(JSON.stringify({ runId, agentUserId, agentId, productId, orderId, paymentId, deliveryId, settlementId: settlement.id, adjustmentId: adjustment.id }));
});
