export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3004', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://payment_svc:payment_pass@localhost:5432/ecommerce',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? '20', 10),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'payment-service',
    groupId: process.env.KAFKA_GROUP_ID ?? 'payment-service-group',
  },
  pg: {
    url: process.env.PAYMENT_GATEWAY_URL ?? 'http://localhost:9999/pay',
    apiKey: process.env.PAYMENT_GATEWAY_API_KEY ?? 'test-key',
  },
} as const;
