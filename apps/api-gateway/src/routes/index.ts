import { Router } from 'express';
import { config } from '../config';
import { requireAuth } from '../middleware/authenticate';
import { createServiceProxy } from '../proxy/create-proxy';
import { Logger } from '@ecommerce/logger';

export function createRoutes(logger: Logger): Router {
  const router = Router();

  // Auth service — public + authenticated routes
  router.use('/auth', createServiceProxy(config.services.auth, { '^/auth': '/api/auth' }, logger));

  // Product service — mostly public reads, protected writes
  router.use('/products', createServiceProxy(config.services.product, { '^/products': '/api/products' }, logger));

  // Search service — public
  router.use('/search', createServiceProxy(config.services.search, { '^/search': '/api/search' }, logger));

  // Cart service — requires auth
  router.use('/cart', requireAuth, createServiceProxy(config.services.cart, { '^/cart': '/api/cart' }, logger));

  // Order service — requires auth
  router.use('/orders', requireAuth, createServiceProxy(config.services.order, { '^/orders': '/api/orders' }, logger));

  // Payment service — requires auth
  router.use('/payments', requireAuth, createServiceProxy(config.services.payment, { '^/payments': '/api/payments' }, logger));

  // Inventory service — agent/admin only (enforced downstream)
  router.use('/inventory', requireAuth, createServiceProxy(config.services.inventory, { '^/inventory': '/api/inventory' }, logger));

  // Delivery service — requires auth
  router.use('/deliveries', requireAuth, createServiceProxy(config.services.delivery, { '^/deliveries': '/api/deliveries' }, logger));

  // Admin service — admin/super-admin only (enforced downstream)
  router.use('/admin', requireAuth, createServiceProxy(config.services.admin, { '^/admin': '/api/admin' }, logger));

  // Notification service — requires auth
  router.use('/notifications', requireAuth, createServiceProxy(config.services.notification, { '^/notifications': '/api/notifications' }, logger));

  // Review reads are public; write endpoints enforce verified identity downstream.
  router.use('/reviews', createServiceProxy(config.services.review, { '^/reviews': '/api/reviews' }, logger));

  // Agents sub-routes (served by auth-service)
  router.use('/agents', createServiceProxy(config.services.auth, { '^/agents': '/api/agents' }, logger));
  router.use('/users', requireAuth, createServiceProxy(config.services.auth, { '^/users': '/api/users' }, logger));

  return router;
}
