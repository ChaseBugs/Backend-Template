const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { RabbitMQClient } = require('@ecommerce/rabbitmq-client');

test('RabbitMQ confirms publication and delivers a bound persistent message once', { timeout: 20000 }, async () => {
  const marker = randomUUID();
  const exchange = `integration.${marker}`;
  const queue = `integration.${marker}`;
  const client = new RabbitMQClient({
    url: process.env.INTEGRATION_RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
    heartbeat: 10,
  });
  let timer;

  try {
    await client.connect();
    await client.assertExchange(exchange, 'direct', { durable: false, autoDelete: true });
    await client.assertQueue(queue, { durable: false, exclusive: true, autoDelete: true });
    await client.bindQueue(queue, exchange, marker);

    const received = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${queue}`)), 10000);
      void client.consume(queue, async (message) => resolve(client.parseMessage(message)), 1, 0).catch(reject);
    });
    assert.equal(await client.publish(exchange, marker, { marker }), true);
    assert.deepEqual(await received, { marker });
  } finally {
    clearTimeout(timer);
    if (client.isReady()) {
      await client.getChannel().deleteQueue(queue).catch(() => undefined);
      await client.getChannel().deleteExchange(exchange).catch(() => undefined);
    }
    await client.close().catch(() => undefined);
  }
});
