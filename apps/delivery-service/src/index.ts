import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Counter, createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createKafka, KafkaProducer, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic, DeliveryGroupStatus, successResponse, errorResponse, buildPagination, buildPaginatedResult } from '@ecommerce/shared';
import { toHttpError, ForbiddenError, NotFoundError } from '@ecommerce/errors';
import { buildFulfillmentSummary } from './application/fulfillment-summary';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { DeliveryRepository } from './domain/repositories/delivery.repository';
import { DeliveryUseCases } from './application/use-cases/delivery.use-cases';
import { DeliveryDelayMonitor } from './delivery-delay.monitor';

const logger = createLogger({ service: 'delivery-service', level: config.logLevel });

async function resolveReturnAmount(orderId: string, userId: string, agentId: string): Promise<number> {
  const response = await fetch(`${config.services.orderUrl}/internal/orders/${encodeURIComponent(orderId)}/return-context?userId=${encodeURIComponent(userId)}&agentId=${encodeURIComponent(agentId)}`, {
    headers: { 'x-internal-service-token': config.internalServiceToken }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new ForbiddenError('Unable to resolve return amount');
  const body = await response.json() as { data?: { refundAmount: number } };
  if (!body.data?.refundAmount) throw new ForbiddenError('No returnable amount found');
  return body.data.refundAmount;
}

async function bootstrap(): Promise<void> {
  if (!Number.isInteger(config.delayMonitor.intervalMs) || config.delayMonitor.intervalMs < 1000) {
    throw new Error('DELIVERY_DELAY_SCAN_INTERVAL_MS must be an integer of at least 1000');
  }
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  const observability = createHttpObservability('delivery-service', logger);
  const agentOrders = new Counter({
    name: 'delivery_service_agent_orders_total',
    help: 'New delivery groups created per agent, representing agent order throughput',
    labelNames: ['agent_id'],
    registers: [observability.registry],
  });
  const repo = new DeliveryRepository();
  const useCases = new DeliveryUseCases(repo, kafkaProducer, logger, {
    recordAgentOrder: (agentId) => agentOrders.inc({ agent_id: agentId }),
  });
  const delayMonitor = new DeliveryDelayMonitor(
    repo, kafkaProducer, config.delayMonitor.thresholdHours, config.delayMonitor.batchSize, logger,
  );
  let delayScanRunning = false;
  const runDelayScan = async () => {
    if (delayScanRunning) return;
    delayScanRunning = true;
    try { await delayMonitor.scan(); }
    catch (error) { logger.error({ error }, 'Delayed delivery scan failed'); }
    finally { delayScanRunning = false; }
  };
  await runDelayScan();
  const delayScanTimer = setInterval(runDelayScan, config.delayMonitor.intervalMs);
  delayScanTimer.unref();

  // Listen for ORDER_PAID to auto-create delivery groups. order-service emits this
  // (not payment-service's PAYMENT_COMPLETED) because only order-service has the
  // line items with agentId needed to split one order into per-agent delivery groups.
  const consumer = new KafkaConsumer(
    kafka,
    { groupId: config.kafka.groupId, topics: [], dlqTopic: 'delivery.events.dlq', maxRetries: 3 },
    logger,
  );
  await consumer.connect({ topics: [KafkaTopic.ORDER_PAID, KafkaTopic.ORDER_CANCELLED, KafkaTopic.PAYMENT_REFUNDED], fromBeginning: false });
  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    if (payload.topic === KafkaTopic.ORDER_PAID) {
      await useCases.createGroupsForOrder({
        orderId: event.payload.orderId,
        userId: event.payload.userId,
        paymentId: event.payload.paymentId,
        items: event.payload.items,
      });
    } else if (payload.topic === KafkaTopic.ORDER_CANCELLED) {
      await useCases.cancelPreparingGroups(event.payload.orderId);
    } else if (payload.topic === KafkaTopic.PAYMENT_REFUNDED) {
      await useCases.completeReturn(event.payload.referenceId, event.payload.refundAmount);
    }
  });

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(observability.middleware);

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
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'postgres', check: () => pool.query('SELECT 1') },
    { name: 'kafka-producer', check: async () => kafkaProducer.isReady() },
    { name: 'kafka-consumer', check: async () => consumer.isReady() },
  ]));

  // The delivery projection persists the buyer ID, so both buyer and agent
  // ownership can be enforced without a cross-service lookup.
  app.get('/api/deliveries/order/:orderId', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      const groups = await useCases.getGroupsByOrder(req.params.orderId);
      const isAdmin = req.user.role === 'admin' || req.user.role === 'super-admin';
      if (req.user.role === 'agent' && !isAdmin && !groups.some((g) => g.agentId === req.user.agentId)) {
        throw new ForbiddenError('You do not fulfill any part of this order');
      }
      if (req.user.role === 'user' && !groups.some((g) => g.userId === req.user.id)) {
        throw new ForbiddenError('You do not own this order');
      }
      res.json(successResponse(groups));
    } catch (err) { next(err); }
  });

  // Agent: get my delivery groups
  app.get('/api/deliveries/my', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      if (req.user.role !== 'agent') throw new ForbiddenError('Agent access required');
      const { page, limit } = buildPagination(req.query);
      const status = typeof req.query.status === 'string' ? req.query.status as DeliveryGroupStatus : undefined;
      if (status && !Object.values(DeliveryGroupStatus).includes(status)) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid delivery status'));
      }
      const { groups, total } = await useCases.getAgentGroups(req.user.agentId, page, limit, status);
      res.json(successResponse(buildPaginatedResult(groups, total, page, limit)));
    } catch (err) { next(err); }
  });

  // Seller dashboard: fulfillment queue counts bucketed by status.
  app.get('/api/deliveries/my/summary', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      if (req.user.role !== 'agent') throw new ForbiddenError('Agent access required');
      const rows = await repo.getAgentStatusCounts(req.user.agentId);
      res.json(successResponse(buildFulfillmentSummary(rows)));
    } catch (err) { next(err); }
  });

  // Agent: mark as shipped (enter tracking number)
  app.patch('/api/deliveries/:id/ship', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      const isAdmin = req.user.role === 'admin' || req.user.role === 'super-admin';
      if (!isAdmin && req.user.role !== 'agent') throw new ForbiddenError('Agent or admin access required');
      const { courierName, trackingNumber } = req.body;
      await useCases.ship(req.params.id, isAdmin ? undefined : req.user.agentId, courierName, trackingNumber);
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

  app.patch('/api/deliveries/:id/status', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      const isAdmin = req.user.role === 'admin' || req.user.role === 'super-admin';
      if (!isAdmin) throw new ForbiddenError('Admin access required');
      const status = String(req.body?.status ?? '') as DeliveryGroupStatus;
      if (!Object.values(DeliveryGroupStatus).includes(status)) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Invalid delivery status'));
      }
      await useCases.updateStatusByAdmin(req.params.id, status);
      res.json(successResponse({ message: 'Delivery status updated' }));
    } catch (err) { next(err); }
  });

  app.get('/api/deliveries/my/pending', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      if (req.user.role !== 'agent') throw new ForbiddenError('Agent access required');
      const { page, limit } = buildPagination(req.query);
      const { groups, total } = await useCases.getAgentGroups(req.user.agentId, page, limit, DeliveryGroupStatus.PREPARING);
      res.json(successResponse(buildPaginatedResult(groups, total, page, limit)));
    } catch (err) { next(err); }
  });

  // Buyer: confirm receipt of their own shipped group.
  app.post('/api/deliveries/:id/confirm', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      if (req.user.role !== 'user') throw new ForbiddenError('Buyer access required');
      await useCases.confirmDelivered(req.params.id, req.user.id);
      res.json(successResponse({ message: 'Delivery confirmed' }));
    } catch (err) { next(err); }
  });

  // User: request return
  app.post('/api/deliveries/:id/return', extractUser, requireAuth, async (req: any, res: any, next: any) => {
    try {
      const { reason } = req.body;
      if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 1000) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', 'A return reason is required'));
      }
      const group = await repo.findById(req.params.id);
      if (!group) throw new NotFoundError('DeliveryGroup', req.params.id);
      if (group.userId !== req.user.id) throw new ForbiddenError('You do not own this delivery group');
      const refundAmount = await resolveReturnAmount(group.orderId, req.user.id, group.agentId);
      await useCases.requestReturn(req.params.id, req.user.id, reason.trim(), refundAmount);
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
    clearInterval(delayScanTimer);
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
