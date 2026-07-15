const os = require('os');
const cpus = os.cpus().length;

const DATABASE_ENV_BY_SERVICE = {
  'auth-service': 'AUTH_DATABASE_URL',
  'product-service': 'PRODUCT_DATABASE_URL',
  'order-service': 'ORDER_DATABASE_URL',
  'payment-service': 'PAYMENT_DATABASE_URL',
  'inventory-service': 'INVENTORY_DATABASE_URL',
  'admin-service': 'ADMIN_DATABASE_URL',
  'notification-service': 'NOTIFICATION_DATABASE_URL',
  'delivery-service': 'DELIVERY_DATABASE_URL',
  'review-service': 'REVIEW_DATABASE_URL',
};

function requiredEnvironment(name, minimumLength = 1) {
  const value = process.env[name];
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} is required by the production PM2 configuration`);
  }
  return value;
}

requiredEnvironment('JWT_SECRET', 64);
requiredEnvironment('INTERNAL_SERVICE_TOKEN', 32);
requiredEnvironment('ALLOWED_ORIGINS');
for (const variable of Object.values(DATABASE_ENV_BY_SERVICE)) requiredEnvironment(variable);

const BASE_ENV = {
  NODE_ENV: 'production',
  NODE_OPTIONS: '--max-old-space-size=512',
};

function service(name, port, instances = cpus) {
  const databaseVariable = DATABASE_ENV_BY_SERVICE[name];
  return {
    name,
    script: `apps/${name}/dist/index.js`,
    node_args: '--require ./packages/logger/dist/tracing.js',
    instances,
    exec_mode: 'cluster',
    max_memory_restart: '600M',
    restart_delay: 3000,
    max_restarts: 10,
    watch: false,
    env: {
      ...BASE_ENV,
      PORT: port,
      ...(databaseVariable ? { DATABASE_URL: process.env[databaseVariable] } : {}),
      OTEL_SERVICE_NAME: name,
      OTEL_ENABLED: process.env.OTEL_ENABLED || 'false',
      OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318',
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
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 10000,
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

    // Review service — verified-purchase reviews and rating aggregates
    service('review-service', 3011),

    // Sync worker — Kafka consumer, CQRS read model sync
    {
      ...service('sync-worker', 3012),
      instances: 1,
      exec_mode: 'fork',
    },

    // Admin dashboard - same-origin API calls are routed through Nginx.
    {
      ...service('admin-dashboard', 4001, 1),
      script: 'node_modules/next/dist/bin/next',
      args: 'start apps/admin-dashboard',
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
