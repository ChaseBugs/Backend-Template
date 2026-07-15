import { randomUUID } from 'crypto';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { Logger } from '@ecommerce/logger';
import { KafkaTopic } from '@ecommerce/shared';

export interface HealthTarget {
  name: string;
  url: string;
}

export const DEFAULT_SYSTEM_HEALTH_TARGETS = [
  'api-gateway=http://localhost:3000/ready',
  'auth-service=http://localhost:3001/ready',
  'product-service=http://localhost:3002/ready',
  'order-service=http://localhost:3003/ready',
  'payment-service=http://localhost:3004/ready',
  'cart-service=http://localhost:3005/ready',
  'search-service=http://localhost:3006/ready',
  'inventory-service=http://localhost:3007/ready',
  'notification-service=http://localhost:3009/ready',
  'delivery-service=http://localhost:3010/ready',
  'review-service=http://localhost:3011/ready',
  'sync-worker=http://localhost:3012/ready',
].join(',');

type HealthChecker = (target: HealthTarget) => Promise<void>;

export function parseHealthTargets(value: string): HealthTarget[] {
  if (!value.trim()) return [];
  const seen = new Set<string>();
  return value.split(',').map((entry) => {
    const separator = entry.indexOf('=');
    if (separator <= 0) throw new Error(`Invalid system health target: ${entry}`);
    const name = entry.slice(0, separator).trim();
    const url = entry.slice(separator + 1).trim();
    if (!/^[a-z0-9-]+$/.test(name) || seen.has(name)) throw new Error(`Invalid or duplicate system health target name: ${name}`);
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Unsupported health target protocol: ${parsed.protocol}`);
    seen.add(name);
    return { name, url: parsed.toString() };
  });
}

export async function checkReadiness(target: HealthTarget): Promise<void> {
  const response = await fetch(target.url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json() as { status?: string };
  if (body.status !== 'ready') throw new Error(`Unexpected readiness status: ${body.status ?? 'missing'}`);
}

export class SystemHealthMonitor {
  private readonly states = new Map<string, { failures: number; alerted: boolean }>();

  constructor(
    private readonly targets: HealthTarget[],
    private readonly producer: Pick<KafkaProducer, 'send'>,
    private readonly failureThreshold: number,
    private readonly checker: HealthChecker = checkReadiness,
    private readonly logger?: Logger,
  ) {
    if (!Number.isInteger(failureThreshold) || failureThreshold <= 0) throw new Error('System health failure threshold must be a positive integer');
  }

  async scan(now = new Date()): Promise<void> {
    await Promise.all(this.targets.map(async (target) => {
      const state = this.states.get(target.name) ?? { failures: 0, alerted: false };
      try {
        await this.checker(target);
        if (state.alerted) this.logger?.info({ target: target.name }, 'Monitored service recovered');
        this.states.set(target.name, { failures: 0, alerted: false });
      } catch (error) {
        state.failures += 1;
        this.states.set(target.name, state);
        this.logger?.warn({ target: target.name, failures: state.failures, error }, 'Monitored service is not ready');
        if (state.failures < this.failureThreshold || state.alerted) return;
        const eventId = randomUUID();
        await this.producer.send(KafkaTopic.SYSTEM_WARNING, {
          topic: KafkaTopic.SYSTEM_WARNING,
          payload: {
            source: target.name,
            code: 'SERVICE_UNREADY',
            message: `${target.name} failed ${state.failures} consecutive readiness checks`,
            targetUrl: target.url,
            consecutiveFailures: state.failures,
            detectedAt: now.toISOString(),
          },
        }, target.name, eventId);
        state.alerted = true;
      }
    }));
  }
}
