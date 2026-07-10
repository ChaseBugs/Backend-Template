import Redis, { Cluster, ClusterOptions, RedisOptions } from 'ioredis';
import { Logger } from '@ecommerce/logger';

export interface RedisClusterConfig {
  nodes: Array<{ host: string; port: number }>;
  options?: Partial<ClusterOptions>;
}

export interface RedisSingleConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  options?: Partial<RedisOptions>;
}

export function createRedisCluster(config: RedisClusterConfig, logger?: Logger): Cluster {
  const cluster = new Redis.Cluster(config.nodes, {
    redisOptions: {
      enableAutoPipelining: true,
      maxRetriesPerRequest: 3,
    },
    clusterRetryStrategy: (times: number) => Math.min(times * 100, 3000),
    ...config.options,
  });

  cluster.on('connect', () => logger?.info('Redis cluster connected'));
  cluster.on('error', (err) => logger?.error({ err }, 'Redis cluster error'));
  cluster.on('reconnecting', () => logger?.warn('Redis cluster reconnecting'));

  return cluster;
}

export function createRedisClient(config: RedisSingleConfig, logger?: Logger): Redis {
  const client = new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db ?? 0,
    enableAutoPipelining: true,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
    ...config.options,
  });

  client.on('connect', () => logger?.info('Redis connected'));
  client.on('error', (err) => logger?.error({ err }, 'Redis error'));
  client.on('reconnecting', () => logger?.warn('Redis reconnecting'));

  return client;
}

export type RedisClient = Redis | Cluster;
