import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@ecommerce/logger';
import { createKafka, KafkaProducer, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic, successResponse, errorResponse, buildPagination, buildPaginatedResult } from '@ecommerce/shared';
import { toHttpError, ForbiddenError, NotFoundError } from '@ecommerce/errors';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { DeliveryRepository } from './domain/repositories/delivery.repository';
import { DeliveryUseCases } from './application/use-cases/delivery.use-cases';

const logger = createLogger({ service: 'delivery-service', level: config.logLevel });

async function bootstrap(): Promise<void> {
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  const repo = new DeliveryRepository();
  const useCases = new DeliveryUseCases(repo, kafkaProducer, logger);

  // Listen for ORDER_PAID to auto-create delivery groups. order-service emits this
  // (not payment-service's PAYMENT_COMPLETED) because only order-service has the
  // line items with agentId needed to split one order into per-agent delivery groups.
  const consumer = new KafkaConsumer(kafka, { groupId: config.kafka.groupId, topics: [] }, logger);
  await consumer.connect({ topics: [KafkaTopic.ORDER_PAID], fromBeginning: false });
  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    if (payload.topic === KafkaTopic.ORDER_PAID) {
      await useCases.createGroupsForOrder({
        orderId: event.payload.orderId,
        items: event.payload.items,
      });
    }
  });

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const agentId = req.headers['x-agent-id'];
    if (userId && userRole) req.user = { id: userId, role: userRole, agentId };
    next();
  };

  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ success: false });
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'delivery-service' }));

  // Get delivery groups for an order.
  // NOTE: only the agent branch is verified here — delivery-service's schema has no
  // record of the order's buyer, so a buyer-ownership check would need a cross-service
  // lookup to order-service. Deferred; admin/agent access is enforced, user access is not.
  app.get('/api/deliveries/order/:orderId', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      const groups = await useCases.getGroupsByOrder(req.params.orderId);
      const isAdmin = req.user.role === 'admin' || req.user.role === 'super-admin';
      if (req.user.role === 'agent' && !isAdmin && !groups.some((g) => g.agentId === req.user.agentId)) {
        throw new ForbiddenError('You do not fulfill any part of this order');
      }
      res.json(successResponse(groups));
    } catch (err) { next(err); }
  });

  // Agent: get my delivery groups
  app.get('/api/deliveries/my', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      if (req.user.role !== 'agent') throw new ForbiddenError('Agent access required');
      const { page, limit } = buildPagination(req.query);
      const { groups, total } = await useCases.getAgentGroups(req.user.agentId, page, limit);
      res.json(successResponse(buildPaginatedResult(groups, total, page, limit)));
    } catch (err) { next(err); }
  });

  // Agent: mark as shipped (enter tracking number)
  app.patch('/api/deliveries/:id/ship', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      if (req.user.role !== 'agent') throw new ForbiddenError('Agent access required');
      const { courierName, trackingNumber } = req.body;
      await useCases.ship(req.params.id, req.user.agentId, courierName, trackingNumber);
      res.json(successResponse({ message: 'Delivery marked as shipped' }));
    } catch (err) { next(err); }
  });

  // Mark as delivered (owning agent, or admin/super-admin for the logistics-webhook path)
  app.patch('/api/deliveries/:id/deliver', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      const isAdmin = req.user.role === 'admin' || req.user.role === 'super-admin';
      if (!isAdmin && req.user.role !== 'agent') throw new ForbiddenError('Agent or admin access required');
      await useCases.markDelivered(req.params.id, isAdmin ? undefined : req.user.agentId);
      res.json(successResponse({ message: 'Delivery marked as delivered' }));
    } catch (err) { next(err); }
  });

  // User: request return
  app.post('/api/deliveries/:id/return', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      const { reason, refundAmount } = req.body;
      await useCases.requestReturn(req.params.id, req.user.id, reason, refundAmount);
      res.json(successResponse({ message: 'Return request submitted' }));
    } catch (err) { next(err); }
  });

  app.use((err: unknown, _req: any, res: any, _next: any) => {
    const { statusCode, code, message, details } = toHttpError(err);
    res.status(statusCode).json(errorResponse(code, message, details));
  });

  const server = app.listen(config.port, () => {
    logger.info(`delivery-service listening on port ${config.port}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
    server.close(async () => {
      await consumer.disconnect();
      await kafkaProducer.disconnect();
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => { logger.fatal({ err }, 'Uncaught exception'); process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });
}

bootstrap().catch((err) => { console.error('Failed to start delivery-service:', err); process.exit(1); });
