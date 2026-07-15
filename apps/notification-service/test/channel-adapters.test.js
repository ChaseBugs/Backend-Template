const test = require('node:test');
const assert = require('node:assert/strict');
const { NotificationChannelAdapters } = require('../dist/channel-adapters');

const message = {
  notificationId: 'notification-1', eventId: 'event-1', userId: 'user-1',
  type: 'ORDER_CREATED', title: 'Order received', body: 'Your order was received.',
  metadata: {}, timestamp: new Date(0).toISOString(),
};

test('email adapter resolves contact, sends mail, and records delivery', async (t) => {
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('RETURNING status')) return { rows: [{ status: 'PROCESSING' }] };
    return { rows: [] };
  } };
  const sent = [];
  const transport = { sendMail: async (mail) => { sent.push(mail); return { messageId: 'smtp-1' }; } };
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({
    data: { userId: 'user-1', email: 'user@example.com', name: 'Test User' },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));

  const adapters = new NotificationChannelAdapters(pool, 'http://auth', 'token', transport, 'from@example.com');
  await adapters.email(message);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to.address, 'user@example.com');
  assert.ok(queries.some((query) => query.sql.includes("status = 'SENT'")));
});

test('already-sent channel delivery is idempotent', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  let sends = 0;
  const transport = { sendMail: async () => { sends += 1; } };
  const adapters = new NotificationChannelAdapters(pool, 'http://auth', 'token', transport, 'from@example.com');
  await adapters.email(message);
  assert.equal(sends, 0);
});

test('delivery claim only retries failed or stale processing rows', async () => {
  let claimSql = '';
  const pool = { query: async (sql) => {
    claimSql = sql;
    return { rows: [] };
  } };
  const adapters = new NotificationChannelAdapters(
    pool, 'http://auth', 'token', { sendMail: async () => { throw new Error('must not send'); } }, 'from@example.com',
  );

  await adapters.email(message);

  assert.match(claimSql, /status IN \('PENDING', 'FAILED'\)/);
  assert.match(claimSql, /INTERVAL '5 minutes'/);
});

test('push adapter records failure and rethrows for RabbitMQ retry', async (t) => {
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('RETURNING status')) return { rows: [{ status: 'PROCESSING' }] };
    return { rows: [] };
  } };
  t.mock.method(global, 'fetch', async () => new Response('', { status: 503 }));
  const adapters = new NotificationChannelAdapters(pool, 'http://auth', 'token', undefined, undefined, 'http://push');

  await assert.rejects(() => adapters.push(message), /HTTP 503/);
  assert.ok(queries.some((query) => query.sql.includes("status = 'FAILED'")));
});

test('sms adapter resolves a phone, sends a provider-safe payload, and records delivery', async (t) => {
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('RETURNING status')) return { rows: [{ status: 'PROCESSING' }] };
    return { rows: [] };
  } };
  let request;
  t.mock.method(global, 'fetch', async (url, options) => {
    if (url === 'http://auth/internal/users/user-1/contact') {
      return new Response(JSON.stringify({
        data: { userId: 'user-1', email: 'user@example.com', phone: '01012345678', name: 'Test User' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    request = { url, options };
    return new Response('', { status: 202, headers: { 'x-message-id': 'sms-1' } });
  });
  const adapters = new NotificationChannelAdapters(
    pool, 'http://auth', 'token', undefined, undefined, undefined, undefined, 'http://sms', 'sms-token',
  );

  await adapters.sms(message);

  assert.equal(request.url, 'http://sms');
  assert.equal(request.options.headers.authorization, 'Bearer sms-token');
  assert.deepEqual(JSON.parse(request.options.body), {
    notificationId: 'notification-1', eventId: 'event-1', to: '01012345678',
    text: 'Your order was received.', type: 'ORDER_CREATED', metadata: {},
  });
  assert.ok(queries.some((query) => query.params?.[1] === 'SMS' && query.sql.includes("status = 'SENT'")));
});

test('sms adapter records missing phone as a retryable channel failure', async (t) => {
  const queries = [];
  const pool = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('RETURNING status')) return { rows: [{ status: 'PROCESSING' }] };
    return { rows: [] };
  } };
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({
    data: { userId: 'user-1', email: 'user@example.com', name: 'Test User' },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const adapters = new NotificationChannelAdapters(
    pool, 'http://auth', 'token', undefined, undefined, undefined, undefined, 'http://sms',
  );

  await assert.rejects(() => adapters.sms(message), /no phone number/);
  assert.ok(queries.some((query) => query.params?.[1] === 'SMS' && query.sql.includes("status = 'FAILED'")));
});
