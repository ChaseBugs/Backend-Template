const os = require('os');
const cpus = os.cpus().length;

const BASE_ENV = {
  NODE_ENV: 'production',
  NODE_OPTIONS: '--max-old-space-size=512',
};

function service(name, port, instances = cpus) {
  return {
    name,
    script: `apps/${name}/dist/index.js`,
    instances,
    exec_mode: 'cluster',
    max_memory_restart: '600M',
    restart_delay: 3000,
    max_restarts: 10,
    watch: false,
    env: {
      ...BASE_ENV,
      PORT: port,
    },
    error_file: `logs/${name}/error.log`,
    out_file: `logs/${name}/out.log`,
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  };
}

module.exports = {
  apps: [
    // API Gateway — high traffic, max instances
    {
      ...service('api-gateway', 3000),
      instances: cpus,
    },

    // Auth service — stateless JWT, scale horizontally
    service('auth-service', 3001),

    // Product service — CQRS read-heavy
    service('product-service', 3002),

    // Order service — SAGA orchestrator, fewer instances to reduce contention
    {
      ...service('order-service', 3003),
      instances: Math.max(2, Math.floor(cpus / 2)),
    },

    // Payment service — critical path, circuit breaker inside
    {
      ...service('payment-service', 3004),
      instances: Math.max(2, Math.floor(cpus / 2)),
    },

    // Cart service — Redis-backed, stateless
    service('cart-service', 3005),

    // Search service — OpenSearch proxy + Redis cache
    service('search-service', 3006),

    // Inventory service — Redis Lua atomic ops
    {
      ...service('inventory-service', 3007),
      instances: Math.max(2, Math.floor(cpus / 2)),
    },

    // Admin service — low traffic
    {
      ...service('admin-service', 3008),
      instances: 2,
    },

    // Notification service — Kafka consumer, single instance per broker partition
    {
      ...service('notification-service', 3009),
      instances: 1,
      exec_mode: 'fork',
    },

    // Delivery service
    service('delivery-service', 3010),

    // Sync worker — Kafka consumer, CQRS read model sync
    {
      ...service('sync-worker', 3011),
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
