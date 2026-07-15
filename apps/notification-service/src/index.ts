import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Pool } from 'pg';
import { createHttpObservability, createLogger, createReadinessHandler } from '@ecommerce/logger';
import { createKafka, KafkaConsumer } from '@ecommerce/kafka-client';
import { RabbitMQClient } from '@ecommerce/rabbitmq-client';
import { KafkaTopic, errorResponse, successResponse } from '@ecommerce/shared';
import { v4 as uuidv4 } from 'uuid';
import { mapEventToNotification, NotificationDraft } from './notification.mapper';
import nodemailer from 'nodemailer';
import { NotificationChannelAdapters, NotificationMessage } from './channel-adapters';

const logger = createLogger({ service: 'notification-service', level: process.env.LOG_LEVEL ?? 'info' });
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://notification_svc:notification_pass@localhost:5432/ecommerce',
  max: 10,
});
pool.on('connect', (client) => client.query('SET search_path TO notification, public'));

const EXCHANGE = 'notifications';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL ?? 'http://localhost:3001';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? 'dev-internal-token';

async function resolveAgentUserId(agentId: string): Promise<string> {
  const response = await fetch(`${AUTH_SERVICE_URL}/internal/agents/${encodeURIComponent(agentId)}/user-id`, {
    headers: { 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Unable to resolve notification recipient for agent ${agentId}`);
  const body = await response.json() as { data?: { userId?: string } };
  if (!body.data?.userId) throw new Error(`Agent ${agentId} has no user account`);
  return body.data.userId;
}

async function resolveRoleUserIds(roles: Array<'admin' | 'super-admin'>): Promise<string[]> {
  const response = await fetch(`${AUTH_SERVICE_URL}/internal/users/by-roles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-service-token': INTERNAL_SERVICE_TOKEN },
    body: JSON.stringify({ roles }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Unable to resolve notification recipients for roles ${roles.join(',')}`);
  const body = await response.json() as { data?: { userIds?: string[] } };
  return body.data?.userIds ?? [];
}

async function saveAndQueue(rabbitmq: RabbitMQClient, eventId: string, draft: NotificationDraft): Promise<void> {
  const directUserId = draft.userId ?? (draft.agentId ? await resolveAgentUserId(draft.agentId) : undefined);
  const userIds = directUserId ? [directUserId] : draft.recipientRoles ? await resolveRoleUserIds(draft.recipientRoles) : [];
  if (userIds.length === 0) throw new Error(`Notification ${draft.type} has no active recipient`);

  for (const userId of [...new Set(userIds)]) {
    const result = await pool.query(
    `INSERT INTO notifications (id, event_id, user_id, type, title, body, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id, user_id) DO UPDATE SET event_id = EXCLUDED.event_id
     RETURNING id, queued_at`,
    [uuidv4(), eventId, userId, draft.type, draft.title, draft.body, JSON.stringify(draft.metadata)],
  );
    const notification = result.rows[0];
    if (notification.queued_at) continue;

    await rabbitmq.publish(EXCHANGE, draft.routingKey, {
    notificationId: notification.id,
    eventId,
    userId,
    type: draft.type,
    title: draft.title,
    body: draft.body,
    metadata: draft.metadata,
    timestamp: new Date().toISOString(),
  });
    await pool.query('UPDATE notifications SET queued_at = NOW() WHERE id = $1', [notification.id]);
  }
}

async function bootstrap(): Promise<void> {
  const rabbitmq = new RabbitMQClient({ url: process.env.RABBITMQ_URL ?? 'amqp://localhost' }, logger);
  await rabbitmq.connect();
  await rabbitmq.assertExchange(EXCHANGE, 'topic');

  const smtpEnabled = process.env.SMTP_ENABLED === 'true';
  const smtpTransport = smtpEnabled ? nodemailer.createTransport({
    pool: true,
    host: process.env.SMTP_HOST ?? 'localhost',
    port: parseInt(process.env.SMTP_PORT ?? '25', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
      : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  }) : undefined;
  const adapters = new NotificationChannelAdapters(
    pool,
    AUTH_SERVICE_URL,
    INTERNAL_SERVICE_TOKEN,
    smtpTransport,
    process.env.SMTP_FROM,
    process.env.PUSH_WEBHOOK_URL,
    process.env.PUSH_WEBHOOK_TOKEN,
    process.env.SMS_WEBHOOK_URL,
    process.env.SMS_WEBHOOK_TOKEN,
  );
  if (smtpEnabled) {
    await rabbitmq.consume('notification.email', async (message) => {
      await adapters.email(rabbitmq.parseMessage<NotificationMessage>(message));
    });
  }
  if (process.env.PUSH_WEBHOOK_URL) {
    await rabbitmq.consume('notification.push', async (message) => {
      await adapters.push(rabbitmq.parseMessage<NotificationMessage>(message));
    });
  }
  if (process.env.SMS_WEBHOOK_URL) {
    await rabbitmq.consume('notification.sms', async (message) => {
      await adapters.sms(rabbitmq.parseMessage<NotificationMessage>(message));
    });
  }

  const kafka = createKafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? 'notification-service',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });
  const consumer = new KafkaConsumer(kafka, {
    groupId: process.env.KAFKA_GROUP_ID ?? 'notification-service-group',
    topics: [],
    dlqTopic: 'notification.events.dlq',
    maxRetries: 3,
  }, logger);
  await consumer.connect({
    topics: [
      KafkaTopic.SYSTEM_WARNING,
      KafkaTopic.ORDER_CREATED,
      KafkaTopic.AGENT_APPLICATION_SUBMITTED,
      KafkaTopic.PAYMENT_COMPLETED,
      KafkaTopic.PAYMENT_FAILED,
      KafkaTopic.DELIVERY_GROUP_CREATED,
      KafkaTopic.DELIVERY_DELAYED,
      KafkaTopic.DELIVERY_SHIPPED,
      KafkaTopic.DELIVERY_DELIVERED,
      KafkaTopic.RETURN_REQUESTED,
      KafkaTopic.RETURN_COMPLETED,
      KafkaTopic.AGENT_APPROVED,
      KafkaTopic.AGENT_REJECTED,
      KafkaTopic.AGENT_SETTLEMENT_CREATED,
      KafkaTopic.AGENT_SETTLEMENT_COMPLETED,
      KafkaTopic.STOCK_LOW,
      KafkaTopic.PRODUCT_APPROVED,
      KafkaTopic.PRODUCT_REJECTED,
    ],
    fromBeginning: false,
  });
  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    const draft = mapEventToNotification(payload.topic, event.payload);
    if (draft) await saveAndQueue(rabbitmq, event.eventId, draft);
  });

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  const observability = createHttpObservability('notification-service', logger);
  app.use(observability.middleware);
  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    if (userId) req.user = { id: userId };
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notification-service' }));
  app.get('/metrics', async (_req, res) => res.type(observability.registry.contentType).send(await observability.registry.metrics()));
  app.get('/ready', createReadinessHandler([
    { name: 'postgres', check: () => pool.query('SELECT 1') },
    { name: 'rabbitmq', check: async () => { if (!rabbitmq.isReady()) throw new Error('RabbitMQ is not ready'); } },
    { name: 'kafka-consumer', check: async () => consumer.isReady() },
  ]));
  app.get('/api/notifications', extractUser, async (req: any, res, next) => {
    try {
      if (!req.user) return res.status(401).json(errorResponse('UNAUTHORIZED', 'Authentication required'));
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const result = await pool.query(
        'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [req.user.id, limit],
      );
      return res.json(successResponse(result.rows));
    } catch (error) { next(error); }
  });
  app.patch('/api/notifications/:id/read', extractUser, async (req: any, res, next) => {
    try {
      if (!req.user) return res.status(401).json(errorResponse('UNAUTHORIZED', 'Authentication required'));
      const result = await pool.query(
        'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id',
        [req.params.id, req.user.id],
      );
      if (!result.rows[0]) return res.status(404).json(errorResponse('NOT_FOUND', 'Notification not found'));
      return res.json(successResponse({ id: result.rows[0].id, isRead: true }));
    } catch (error) { next(error); }
  });
  app.use((error: unknown, _req: any, res: any, _next: any) => {
    logger.error({ error }, 'Notification HTTP request failed');
    res.status(500).json(errorResponse('INTERNAL_ERROR', 'Internal server error'));
  });

  const port = parseInt(process.env.PORT ?? '3009', 10);
  const server = app.listen(port, () => logger.info(`notification-service listening on port ${port}`));
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
    server.close(async () => {
      await consumer.disconnect();
      await rabbitmq.close();
      smtpTransport?.close();
      await pool.end();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (error) => { logger.fatal({ error }, 'Uncaught exception'); process.exit(1); });
  process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'Unhandled rejection'); process.exit(1); });
}

bootstrap().catch((error) => { console.error('Failed to start notification-service:', error); process.exit(1); });
