import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_NAMESPACE } from '@opentelemetry/semantic-conventions';

export interface TracingConfig {
  enabled: boolean;
  serviceName: string;
  endpoint: string;
}

export function resolveTracingConfig(env: NodeJS.ProcessEnv = process.env): TracingConfig {
  const enabled = env.OTEL_ENABLED === 'true';
  const serviceName = env.OTEL_SERVICE_NAME?.trim() || 'unknown-service';
  const baseEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || 'http://127.0.0.1:4318';
  const parsed = new URL(baseEndpoint);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Unsupported OTLP protocol: ${parsed.protocol}`);
  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
    || `${parsed.toString().replace(/\/$/, '')}/v1/traces`;
  return { enabled, serviceName, endpoint };
}

const globalKey = Symbol.for('ecommerce.opentelemetry.sdk');
const globalState = globalThis as typeof globalThis & { [globalKey]?: NodeSDK };

export function startTracing(env: NodeJS.ProcessEnv = process.env): NodeSDK | undefined {
  const config = resolveTracingConfig(env);
  if (!config.enabled) return undefined;
  if (globalState[globalKey]) return globalState[globalKey];

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_NAMESPACE]: 'ecommerce-backend',
    }),
    traceExporter: new OTLPTraceExporter({ url: config.endpoint }),
    instrumentations: [getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    })],
  });
  sdk.start();
  globalState[globalKey] = sdk;

  const shutdown = () => { void sdk.shutdown().catch((error) => console.error('OpenTelemetry shutdown failed', error)); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('beforeExit', shutdown);
  return sdk;
}

startTracing();
