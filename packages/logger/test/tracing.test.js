const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTracingConfig, startTracing } = require('../dist/tracing');

test('tracing is opt-in and derives the standard OTLP HTTP trace endpoint', () => {
  assert.deepEqual(resolveTracingConfig({
    OTEL_ENABLED: 'false', OTEL_SERVICE_NAME: 'order-service', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://jaeger.internal:4318/',
  }), {
    enabled: false,
    serviceName: 'order-service',
    endpoint: 'http://jaeger.internal:4318/v1/traces',
  });
  assert.equal(startTracing({ OTEL_ENABLED: 'false' }), undefined);
});

test('explicit trace endpoints are preserved and unsafe protocols are rejected', () => {
  assert.equal(resolveTracingConfig({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://collector.internal/custom/traces',
  }).endpoint, 'https://collector.internal/custom/traces');
  assert.throws(() => resolveTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'file:///tmp/traces' }), /Unsupported OTLP protocol/);
});
