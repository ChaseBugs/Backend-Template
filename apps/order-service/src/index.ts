import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createKafka, KafkaProducer, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic, OrderStatus, successResponse, buildPagination, buildPaginatedResult, errorResponse } from '@ecommerce/shared';
import { toHttpError, NotFoundError, ForbiddenError, BadRequestError } from '@ecommerce/errors';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { OrderRepository } from './domain/repositories/order.repository';
import { CreateOrderUseCase } from './application/use-cases/create-order.use-case';
import { isRemotePostalCode, ShippingPolicy } from './application/use-cases/create-order.use-case';
import { CancelOrderUseCase } from './application/use-cases/cancel-order.use-case';
import { AdminUpdateOrderStatusUseCase } from './application/use-cases/admin-update-order-status.use-case';
import { OrderSagaHandler } from './application/saga/order-saga.handler';
import { CreateOrderSchema } from './application/dtos/order.dto';

const logger = createLogger({ service: 'order-service', level: config.logLevel });

interface ResolvedProduct {
  productId: string;
  agentId: string;
  productName: string;
  productImage?: string;
  unitPrice: number;
}

async function resolveProducts(productIds: string[]): Promise<Map<string, ResolvedProduct>> {
  const response = await fetch(`${config.services.productUrl}/internal/products/resolve`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-service-token': config.internalServiceToken,
    },
    body: JSON.stringify({ productIds }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new BadRequestError('One or more products are unavailable');
  }
  const body = await response.json() as { data?: ResolvedProduct[] };
  return new Map((body.data ?? []).map((product) => [product.productId, product]));
}

async function resolveShippingPolicies(agentIds: string[]): Promise<Map<string, ShippingPolicy>> {
  const response = await fetch(`${config.services.authUrl}/internal/agents/shipping-policies`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-service-token': config.internalServiceToken,
    },
    body: JSON.stringify({ agentIds: [...new Set(agentIds)] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new BadRequestError('Unable to resolve seller shipping policies');
  const body = await response.json() as { data?: Record<string, ShippingPolicy> };
  return new Map(Object.entries(body.data ?? {}));
}

async function bootstrap(): Promise<void> {
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  const orderRepo = new OrderRepository();
  const createOrderUseCase = new CreateOrderUseCase(orderRepo, kafkaProducer);
  const cancelOrderUseCase = new CancelOrderUseCase(orderRepo, kafkaProducer);
  const adminUpdateOrderStatus = new AdminUpdateOrderStatusUseCase(orderRepo, kafkaProducer);
  const sagaHandler = new OrderSagaHandler(orderRepo, kafkaProducer, logger);

  const consumer = new KafkaConsumer(
    kafka,
    { groupId: config.kafka.groupId, topics: [], dlqTopic: 'order.events.dlq', maxRetries: 3 },
    logger,
  );

  const sagaTopics = [
    KafkaTopic.INVENTORY_RESERVED,
    KafkaTopic.INVENTORY_RESERVATION_FAILED,
    KafkaTopic.PAYMENT_COMPLETED,
    KafkaTopic.PAYMENT_FAILED,
    KafkaTopic.PAYMENT_REFUNDED,
    KafkaTopic.DELIVERY_SHIPPED,
    KafkaTopic.ALL_DELIVERIES_COMPLETED,
  ];

  await consumer.connect({ topics: sagaTopics, fromBeginning: false });
  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    switch (payload.topic) {
      case KafkaTopic.INVENTORY_RESERVED:
        await sagaHandler.onInventoryReserved(event.payload);
        break;
      case KafkaTopic.INVENTORY_RESERVATION_FAILED:
        await sagaHandler.onInventoryReservationFailed(event.payload);
        break;
      case KafkaTopic.PAYMENT_COMPLETED:
        await sagaHandler.onPaymentCompleted(event.payload);
        break;
      case KafkaTopic.PAYMENT_FAILED:
        await sagaHandler.onPaymentFailed(event.payload);
        break;
      case KafkaTopic.PAYMENT_REFUNDED:
        await sagaHandler.onPaymentRefunded(event.payload);
        break;
      case KafkaTopic.DELIVERY_SHIPPED:
        await sagaHandler.onDeliveryShipped(event.payload);
        break;
      case KafkaTopic.ALL_DELIVERIES_COMPLETED:
        await sagaHandler.onAllDeliveriesCompleted(event.payload);
        break;
    }
  });

  // HTTP API
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  const observability = createHttpObservability('order-service', logger);
  app.use(observability.middleware);

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const agentId = req.headers['x-agent-id'];
    if (userId && userRole) req.user = { id: userId, role: userRole, agentId };
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'order-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'postgres', check: () => pool.query('SELECT 1') },
    { name: 'kafka-producer', check: async () => kafkaProducer.isReady() },
    { name: 'kafka-consumer', check: async () => consumer.isReady() },
  ]));

  app.get('/internal/orders/:id/payment-context', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const order = await orderRepo.findById(req.params.id);
    if (!order) return res.status(404).json(errorResponse('NOT_FOUND', 'Order not found'));
    if (order.status !== OrderStatus.PAYMENT_PENDING) {
      return res.status(409).json(errorResponse('INVALID_ORDER_STATE', `Order is not payable in status: ${order.status}`));
    }
    return res.json(successResponse({
      orderId: order.id,
      sagaId: order.sagaId,
      userId: order.userId,
      amount: order.finalAmount,
      status: order.status,
    }));
  });

  app.get('/internal/orders/:id/review-eligibility', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    const productId = typeof req.query.productId === 'string' ? req.query.productId : '';
    if (!userId || !productId) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'userId and productId are required'));
    const eligible = await orderRepo.isReviewEligible(req.params.id, userId, productId);
    return res.json(successResponse({ eligible }));
  });

  app.get('/internal/orders/:id/return-context', async (req, res) => {
    if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
      return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
    }
    const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : '';
    if (!userId || !agentId) return res.status(400).json(errorResponse('VALIDATION_ERROR', 'userId and agentId are required'));
    const context = await orderRepo.getReturnContext(req.params.id, userId, agentId);
    if (!context || context.refundAmount <= 0) return res.status(404).json(errorResponse('NOT_FOUND', 'Returnable order items not found'));
    return res.json(successResponse(context));
  });

  app.patch('/internal/orders/:id/status', async (req, res, next) => {
    try {
      if (req.headers['x-internal-service-token'] !== config.internalServiceToken) {
        return res.status(403).json(errorResponse('FORBIDDEN', 'Invalid internal service token'));
      }
      const status = String(req.body?.status ?? '') as OrderStatus;
      const changedBy = String(req.body?.changedBy ?? '');
      if (!Object.values(OrderStatus).includes(status) || !changedBy) {
        return res.status(400).json(errorResponse('VALIDATION_ERROR', 'Valid status and changedBy are required'));
      }
      const result = await adminUpdateOrderStatus.execute(String(req.params.id), status, changedBy);
      return res.json(successResponse(result));
    } catch (err) { next(err); }
  });

  app.post('/api/orders', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });

      const parsed = CreateOrderSchema.safeParse(req.body);
      if (!parsed.success) throw new BadRequestError('Invalid order request');
      const input = parsed.data;
      const replay = await createOrderUseCase.replayIfExists(input, req.user.id);
      if (replay) return res.status(200).json(successResponse(replay));
      const productInfoMap = await resolveProducts(input.items.map((item) => item.productId));
      const shippingPolicies = await resolveShippingPolicies([...productInfoMap.values()].map((product) => product.agentId));
      const remoteArea = isRemotePostalCode(input.shippingAddress.postalCode, config.shipping.remotePostalPrefixes);
      const order = await createOrderUseCase.execute(input, req.user.id, productInfoMap, shippingPolicies, remoteArea);
      res.status(201).json(successResponse(order));
    } catch (err) { next(err); }
  });

  app.get('/api/orders', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });
      const { page, limit, offset } = buildPagination(req.query as any);

      let result;
      if (req.user.role === 'agent') {
        result = await orderRepo.findByAgent(req.user.agentId, limit, offset);
      } else if (req.user.role === 'user') {
        result = await orderRepo.findByUser(req.user.id, limit, offset);
      } else {
        result = await orderRepo.findByUser(req.user.id, limit, offset);
      }

      res.json(successResponse(buildPaginatedResult(result.orders, result.total, page, limit)));
    } catch (err) { next(err); }
  });

  app.get('/api/orders/:id', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });
      const order = await orderRepo.findById(req.params.id);
      if (!order) throw new NotFoundError('Order', req.params.id);

      // Users can only see their own orders; agents see orders with their items
      if (req.user.role === 'user' && order.userId !== req.user.id) throw new ForbiddenError();
      if (req.user.role === 'agent' && !order.items.some((i) => i.agentId === req.user.agentId)) throw new ForbiddenError();

      res.json(successResponse(order));
    } catch (err) { next(err); }
  });

  app.patch('/api/orders/:id/cancel', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!reason || reason.length > 500) throw new BadRequestError('Cancellation reason must contain 1 to 500 characters');
      await cancelOrderUseCase.execute(req.params.id, req.user, reason);

      res.json(successResponse({ message: 'Order cancelled' }));
    } catch (err) { next(err); }
  });

  app.use((err: unknown, _req: any, res: any, _next: any) => {
    const { statusCode, code, message, details } = toHttpError(err);
    res.status(statusCode).json(errorResponse(code, message, details));
  });

  const server = app.listen(config.port, () => {
    logger.info(`order-service listening on port ${config.port}`);
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

bootstrap().catch((err) => { console.error('Failed to start order-service:', err); process.exit(1); });
