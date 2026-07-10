import express from 'express';
import { Pool } from 'pg';
import { createLogger } from '@ecommerce/logger';
import { createKafka, KafkaConsumer } from '@ecommerce/kafka-client';
import { RabbitMQClient } from '@ecommerce/rabbitmq-client';
import { KafkaTopic } from '@ecommerce/shared';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger({ service: 'notification-service', level: process.env.LOG_LEVEL ?? 'info' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://notification_svc:notification_pass@localhost:5432/ecommerce', max: 10 });
pool.on('connect', (c) => c.query("SET search_path TO notification, public"));

const EXCHANGE = 'notifications';
const QUEUES = {
  ORDER_NOTIFICATIONS: 'order.notifications',
  DELIVERY_NOTIFICATIONS: 'delivery.notifications',
};

async function saveAndQueue(rabbitmq: RabbitMQClient, userId: string, type: string, title: string, body: string, routingKey: string) {
  // Persist notification to DB
  await pool.query(
    `INSERT INTO notifications (id, user_id, type, title, body) VALUES ($1, $2, $3, $4, $5)`,
    [uuidv4(), userId, type, title, body],
  );

  // Publish to RabbitMQ for fan-out (email, push, SMS)
  await rabbitmq.publish(EXCHANGE, routingKey, { userId, type, title, body, timestamp: new Date().toISOString() });
}

async function bootstrap(): Promise<void> {
  const rabbitmq = new RabbitMQClient(
    { url: process.env.RABBITMQ_URL ?? 'amqp://localhost' },
    logger,
  );
  await rabbitmq.connect();
  await rabbitmq.assertExchange(EXCHANGE, 'topic');
  await rabbitmq.assertQueue(QUEUES.ORDER_NOTIFICATIONS);
  await rabbitmq.assertQueue(QUEUES.DELIVERY_NOTIFICATIONS);
  await rabbitmq.bindQueue(QUEUES.ORDER_NOTIFICATIONS, EXCHANGE, 'order.*');
  await rabbitmq.bindQueue(QUEUES.DELIVERY_NOTIFICATIONS, EXCHANGE, 'delivery.*');

  const kafka = createKafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? 'notification-service',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });

  const consumer = new KafkaConsumer(kafka, { groupId: 'notification-service-group', topics: [] }, logger);
  await consumer.connect({
    topics: [
      KafkaTopic.ORDER_CREATED, KafkaTopic.PAYMENT_COMPLETED, KafkaTopic.PAYMENT_FAILED,
      KafkaTopic.DELIVERY_SHIPPED, KafkaTopic.DELIVERY_DELIVERED, KafkaTopic.AGENT_APPROVED, KafkaTopic.AGENT_REJECTED,
    ],
    fromBeginning: false,
  });

  await consumer.run(async (payload) => {
    const event = consumer.parseMessage<any>(payload);
    const p = event.payload;

    switch (payload.topic) {
      case KafkaTopic.ORDER_CREATED:
        await saveAndQueue(rabbitmq, p.userId, 'ORDER_CREATED', '주문이 접수되었습니다', `주문 #${p.orderId.slice(0, 8)} 이 접수되었습니다.`, 'order.created');
        break;
      case KafkaTopic.PAYMENT_COMPLETED:
        await saveAndQueue(rabbitmq, p.userId ?? '', 'PAYMENT_COMPLETED', '결제가 완료되었습니다', `${p.amount.toLocaleString()}원 결제 완료.`, 'order.paid');
        break;
      case KafkaTopic.PAYMENT_FAILED:
        await saveAndQueue(rabbitmq, p.userId ?? '', 'PAYMENT_FAILED', '결제에 실패했습니다', `결제 실패: ${p.reason}`, 'order.payment_failed');
        break;
      case KafkaTopic.DELIVERY_SHIPPED:
        await saveAndQueue(rabbitmq, p.userId ?? '', 'DELIVERY_SHIPPED', '상품이 발송되었습니다', `송장번호: ${p.trackingNumber} (${p.courierName})`, 'delivery.shipped');
        break;
      case KafkaTopic.DELIVERY_DELIVERED:
        await saveAndQueue(rabbitmq, p.userId ?? '', 'DELIVERY_DELIVERED', '상품이 배달되었습니다', '상품 배달이 완료되었습니다.', 'delivery.delivered');
        break;
      case KafkaTopic.AGENT_APPROVED:
        await saveAndQueue(rabbitmq, p.userId, 'AGENT_APPROVED', '에이전트 승인 완료', '판매자 계정이 승인되었습니다. 상품을 등록해보세요!', 'order.agent_approved');
        break;
      case KafkaTopic.AGENT_REJECTED:
        await saveAndQueue(rabbitmq, p.userId, 'AGENT_REJECTED', '에이전트 신청 거절', `신청이 거절되었습니다: ${p.reason}`, 'order.agent_rejected');
        break;
    }
  });

  const app = express();
  app.use(express.json());

  const extractUser = (req: any, _res: any, next: any) => {
    const userId = req.headers['x-user-id'];
    if (userId) req.user = { id: userId };
    next();
  };

  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'notification-service' }));

  app.get('/api/notifications', extractUser, async (req: any, res: any) => {
    if (!req.user) return res.status(401).json({ success: false });
    const result = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id],
    );
    res.json({ success: true, data: result.rows });
  });

  app.patch('/api/notifications/:id/read', extractUser, async (req: any, res: any) => {
    if (!req.user) return res.status(401).json({ success: false });
    await pool.query(`UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    res.json({ success: true });
  });

  const PORT = parseInt(process.env.PORT ?? '3009', 10);
  const server = app.listen(PORT, () => logger.info(`notification-service listening on port ${PORT}`));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received`);
    server.close(async () => {
      await consumer.disconnect();
      await rabbitmq.close();
      await pool.end();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => { console.error('Failed to start notification-service:', err); process.exit(1); });
