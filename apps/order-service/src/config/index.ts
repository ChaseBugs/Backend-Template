export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3003', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://order_svc:order_pass@localhost:5432/ecommerce',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? '20', 10),
  },
  mongodb: {
    uri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/ecommerce_read',
    dbName: 'ecommerce_read',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    clientId: process.env.KAFKA_CLIENT_ID ?? 'order-service',
    groupId: process.env.KAFKA_GROUP_ID ?? 'order-service-group',
  },
} as const;
