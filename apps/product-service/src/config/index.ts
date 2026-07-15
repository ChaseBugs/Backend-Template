export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3002', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://product_svc:product_pass@localhost:5432/ecommerce',
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
    clientId: process.env.KAFKA_CLIENT_ID ?? 'product-service',
  },

  cache: {
    productTtl: 60 * 60, // 1 hour
    listTtl: 5 * 60,     // 5 min
  },

  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-internal-token',
} as const;
