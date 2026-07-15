export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3007', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://inventory_svc:inventory_pass@localhost:5432/ecommerce',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? '20', 10),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'inventory-service',
    groupId: process.env.KAFKA_GROUP_ID ?? 'inventory-service-group',
  },
  services: {
    productUrl: process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:3002',
  },
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-internal-token',
} as const;
