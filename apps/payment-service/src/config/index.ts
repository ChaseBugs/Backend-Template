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
    mode: (process.env.PAYMENT_GATEWAY_MODE ?? (process.env.NODE_ENV === 'production' ? 'http' : 'mock')) as 'mock' | 'http',
    url: process.env.PAYMENT_GATEWAY_URL ?? 'http://localhost:9999/pay',
    refundUrl: process.env.PAYMENT_GATEWAY_REFUND_URL ?? 'http://localhost:9999/refund',
    apiKey: process.env.PAYMENT_GATEWAY_API_KEY ?? 'test-key',
  },
  services: {
    orderUrl: process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003',
    authUrl: process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001',
  },
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-internal-token',
} as const;
