export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  },

  services: {
    auth: process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001',
    product: process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:3002',
    order: process.env.ORDER_SERVICE_URL ?? 'http://localhost:3003',
    payment: process.env.PAYMENT_SERVICE_URL ?? 'http://localhost:3004',
    cart: process.env.CART_SERVICE_URL ?? 'http://localhost:3005',
    search: process.env.SEARCH_SERVICE_URL ?? 'http://localhost:3006',
    inventory: process.env.INVENTORY_SERVICE_URL ?? 'http://localhost:3007',
    admin: process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3008',
    notification: process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3009',
    delivery: process.env.DELIVERY_SERVICE_URL ?? 'http://localhost:3010',
  },
} as const;
