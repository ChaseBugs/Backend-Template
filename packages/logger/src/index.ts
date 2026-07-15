import pino, { Logger, LoggerOptions } from 'pino';
import { randomUUID } from 'crypto';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';
import { trace } from '@opentelemetry/api';

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { service, level = process.env.LOG_LEVEL || 'info', pretty = process.env.NODE_ENV !== 'production' } = options;

  const pinoOptions: LoggerOptions = {
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  };

  if (pretty) {
    return pino({
      ...pinoOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(pinoOptions);
}

export function createAuditLogger(service: string, filePath: string): Logger {
  if (!filePath.trim()) throw new Error('Audit log file path is required');
  return pino({
    level: 'info',
    base: { service, logType: 'audit' },
    timestamp: pino.stdTimeFunctions.isoTime,
  }, pino.destination({ dest: filePath, mkdir: true, sync: true }));
}

interface HttpRequestLike {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, unknown>;
}

interface HttpResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  once(event: 'finish', listener: () => void): void;
}

interface JsonResponseLike {
  status(code: number): JsonResponseLike;
  json(body: unknown): void;
}

export interface ReadinessCheck {
  name: string;
  check: () => Promise<unknown>;
}

const normalizeRoute = (url: string): string => url.split('?')[0]
  .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
  .replace(/\/[0-9]+(?=\/|$)/g, '/:id');

export function createHttpObservability(service: string, logger: Logger) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: `${service.replace(/-/g, '_')}_` });
  const duration = new Histogram({
    name: `${service.replace(/-/g, '_')}_http_request_duration_seconds`,
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    registers: [registry],
  });
  const requests = new Counter({
    name: `${service.replace(/-/g, '_')}_http_requests_total`,
    help: 'HTTP requests grouped by authenticated role',
    labelNames: ['method', 'route', 'status', 'role'],
    registers: [registry],
  });

  const middleware = (req: HttpRequestLike, res: HttpResponseLike, next: () => void): void => {
    const supplied = req.headers['x-request-id'];
    const requestId = typeof supplied === 'string' && supplied.length > 0 && supplied.length <= 128 ? supplied : randomUUID();
    const suppliedTrace = req.headers['x-trace-id'];
    const activeTraceId = trace.getActiveSpan()?.spanContext().traceId;
    const traceId = activeTraceId ?? (typeof suppliedTrace === 'string' && /^[0-9a-f]{32}$/i.test(suppliedTrace)
      ? suppliedTrace.toLowerCase()
      : randomUUID().replace(/-/g, ''));
    req.headers['x-request-id'] = requestId;
    req.headers['x-trace-id'] = traceId;
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-trace-id', traceId);
    const started = process.hrtime.bigint();
    res.once('finish', () => {
      const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1e9;
      const route = normalizeRoute(req.originalUrl ?? req.url ?? '/');
      const suppliedRole = req.headers['x-user-role'];
      const role = typeof suppliedRole === 'string' && ['user', 'agent', 'admin', 'super-admin'].includes(suppliedRole)
        ? suppliedRole
        : 'anonymous';
      duration.observe({ method: req.method ?? 'UNKNOWN', route, status: String(res.statusCode) }, elapsedSeconds);
      requests.inc({ method: req.method ?? 'UNKNOWN', route, status: String(res.statusCode), role });
      logger.info({
        requestId,
        traceId,
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs: Math.round(elapsedSeconds * 1000),
        userId: req.headers['x-user-id'],
        role: req.headers['x-user-role'],
      }, 'HTTP request completed');
    });
    next();
  };

  return { registry, middleware };
}

export function createReadinessHandler(checks: ReadinessCheck[], timeoutMs = 2000) {
  return async (_req: unknown, res: JsonResponseLike): Promise<void> => {
    const results = await Promise.all(checks.map(async ({ name, check }) => {
      let timeout: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          check(),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
        ]);
        if (result === false) throw new Error(`${name} reported not ready`);
        return [name, 'up'] as const;
      } catch {
        return [name, 'down'] as const;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }));
    const ready = results.every(([, status]) => status === 'up');
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not-ready', dependencies: Object.fromEntries(results) });
  };
}

export function createEventObservability(service: string) {
  const registry = new Registry();
  const prefix = service.replace(/-/g, '_');
  collectDefaultMetrics({ register: registry, prefix: `${prefix}_` });
  const processed = new Counter({
    name: `${prefix}_events_processed_total`,
    help: 'Number of asynchronous events processed',
    labelNames: ['topic', 'status'],
    registers: [registry],
  });
  return {
    registry,
    record(topic: string, status: 'success' | 'failure'): void {
      processed.inc({ topic, status });
    },
  };
}

export type { Logger };
export { Counter, Histogram, Registry, pino };
