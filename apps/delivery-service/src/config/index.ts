export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3010', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://delivery_svc:delivery_pass@localhost:5432/ecommerce',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? '20', 10),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'delivery-service',
    groupId: process.env.KAFKA_GROUP_ID ?? 'delivery-service-group',
  },
  services: {
    orderUrl: process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003',
  },
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-internal-token',
  delayMonitor: {
    thresholdHours: parseInt(process.env.DELIVERY_DELAY_THRESHOLD_HOURS ?? '72', 10),
    intervalMs: parseInt(process.env.DELIVERY_DELAY_SCAN_INTERVAL_MS ?? '300000', 10),
    batchSize: parseInt(process.env.DELIVERY_DELAY_SCAN_BATCH_SIZE ?? '100', 10),
  },
} as const;
