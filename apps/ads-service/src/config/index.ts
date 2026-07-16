export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3013', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://ads_svc:ads_pass@localhost:5432/ecommerce',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS ?? '20', 10),
  },
  services: {
    productUrl: process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:3002',
  },
  internalServiceToken: process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-internal-token',
} as const;
