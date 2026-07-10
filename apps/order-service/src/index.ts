import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createLogger } from '@ecommerce/logger';
import { createKafka, KafkaProducer, KafkaConsumer } from '@ecommerce/kafka-client';
import { KafkaTopic, OrderStatus, successResponse, buildPagination, buildPaginatedResult, errorResponse } from '@ecommerce/shared';
import { toHttpError, NotFoundError, ForbiddenError } from '@ecommerce/errors';
import { config } from './config';
import { pool } from './infrastructure/db/pool';
import { OrderRepository } from './domain/repositories/order.repository';
import { CreateOrderUseCase } from './application/use-cases/create-order.use-case';
import { OrderSagaHandler } from './application/saga/order-saga.handler';

const logger = createLogger({ service: 'order-service', level: config.logLevel });

async function bootstrap(): Promise<void> {
  const kafka = createKafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const kafkaProducer = new KafkaProducer(kafka, logger);
  await kafkaProducer.connect();

  const orderRepo = new OrderRepository();
  const createOrderUseCase = new CreateOrderUseCase(orderRepo, kafkaProducer);
  const sagaHandler = new OrderSagaHandler(orderRepo, kafkaProducer, logger);

  const consumer = new KafkaConsumer(
    kafka,
    { groupId: config.kafka.groupId, topics: [] },
    logger,
  );

  const sagaTopics = [
    KafkaTopic.INVENTORY_RESERVED,
    KafkaTopic.INVENTORY_RESERVATION_FAILED,
    KafkaTopic.PAYMENT_COMPLETED,
    KafkaTopic.PAYMENT_FAILED,
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

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    const agentId = req.headers['x-agent-id'];
    if (userId && userRole) req.user = { id: userId, role: userRole, agentId };
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'order-service' }));

  app.post('/api/orders', extractUser, async (req: any, res: any, next: any) => {
    try {
      if (!req.user) return res.status(401).json({ success: false });

      // productInfoMap would be fetched from product-service in production
      // here caller must pass product info in body for simplicity in this template
      const { items, shippingAddress, productInfoMap: rawMap } = req.body;
      const productInfoMap = new Map(Object.entries(rawMap ?? {})) as Map<string, any>;

      const order = await createOrderUseCase.execute({ items, shippingAddress }, req.user.id, productInfoMap);
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
      const order = await orderRepo.findById(req.params.id);
      if (!order) throw new NotFoundError('Order', req.params.id);
      if (req.user.role === 'user' && order.userId !== req.user.id) throw new ForbiddenError();

      await orderRepo.updateStatus(req.params.id, OrderStatus.CANCELLED, { cancelReason: req.body.reason });
      await kafkaProducer.send(
        KafkaTopic.ORDER_CANCELLED,
        { topic: KafkaTopic.ORDER_CANCELLED, payload: { orderId: order.id, sagaId: order.sagaId, items: order.items } },
        order.sagaId,
      );

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
