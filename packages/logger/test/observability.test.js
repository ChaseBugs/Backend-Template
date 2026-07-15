const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHttpObservability } = require('../dist');
const { createAuditLogger } = require('../dist');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('HTTP observability counts normalized routes by bounded user role', async () => {
  const observability = createHttpObservability('test-service', { info() {} });
  const response = new EventEmitter();
  response.statusCode = 200;
  response.setHeader = () => {};
  const request = {
    method: 'GET', originalUrl: '/api/orders/11111111-1111-4111-8111-111111111111?expand=true',
    headers: { 'x-user-role': 'agent' },
  };
  observability.middleware(request, response, () => {});
  assert.match(request.headers['x-trace-id'], /^[0-9a-f]{32}$/);
  response.emit('finish');
  const metrics = await observability.registry.metrics();
  assert.match(metrics, /test_service_http_requests_total\{method="GET",route="\/api\/orders\/:id",status="200",role="agent"\} 1/);
});

test('valid trace IDs are preserved for downstream proxy propagation', () => {
  const observability = createHttpObservability('trace-test', { info() {} });
  const response = new EventEmitter();
  response.statusCode = 200;
  const headers = {};
  response.setHeader = (name, value) => { headers[name] = value; };
  const request = { method: 'GET', url: '/', headers: { 'x-trace-id': 'ABCDEF0123456789ABCDEF0123456789' } };
  observability.middleware(request, response, () => {});
  assert.equal(request.headers['x-trace-id'], 'abcdef0123456789abcdef0123456789');
  assert.equal(headers['x-trace-id'], request.headers['x-trace-id']);
});

test('untrusted role labels collapse to anonymous', async () => {
  const observability = createHttpObservability('anonymous-test', { info() {} });
  const response = new EventEmitter();
  response.statusCode = 401;
  response.setHeader = () => {};
  observability.middleware({ method: 'POST', url: '/login', headers: { 'x-user-role': 'arbitrary-value' } }, response, () => {});
  response.emit('finish');
  assert.match(await observability.registry.metrics(), /role="anonymous"/);
});

test('audit logger writes isolated structured JSON without console transport', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ecommerce-audit-'));
  const file = join(directory, 'admin', 'audit.log');
  try {
    const logger = createAuditLogger('admin-service', file);
    logger.info({ actorId: 'user-1', action: 'order.status.update' }, 'Privileged mutation');
    await new Promise((resolve, reject) => logger.flush((error) => error ? reject(error) : resolve()));
    const entry = JSON.parse(readFileSync(file, 'utf8').trim());
    assert.equal(entry.logType, 'audit');
    assert.equal(entry.actorId, 'user-1');
    assert.equal(entry.action, 'order.status.update');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
