const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createKafka, KafkaProducer, KafkaConsumer } = require('@ecommerce/kafka-client');

test('Kafka publishes and consumes an event with its key and envelope intact', { timeout: 20000 }, async () => {
  const topic = process.env.INTEGRATION_KAFKA_TOPIC ?? 'order.events.dlq';
  const marker = randomUUID();
  const kafka = createKafka({
    clientId: `integration-${marker}`,
    brokers: (process.env.INTEGRATION_KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });
  const producer = new KafkaProducer(kafka);
  const consumer = new KafkaConsumer(kafka, { groupId: `integration-${marker}`, topics: [topic] });
  let timer;
  try {
    await consumer.connect({ topics: [topic], fromBeginning: false });
    const received = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${topic}`)), 10000);
      void consumer.run(async (payload) => {
        if (payload.message.key?.toString() !== marker) return;
        resolve(consumer.parseMessage(payload));
      }).catch(reject);
    });
    await producer.connect();
    await producer.send(topic, { topic, payload: { marker } }, marker);
    const event = await received;
    assert.equal(event.topic, topic);
    assert.equal(event.payload.marker, marker);
    assert.equal(event.version, 1);
    assert.ok(event.eventId);
  } finally {
    clearTimeout(timer);
    await producer.disconnect().catch(() => {});
    await consumer.disconnect().catch(() => {});
  }
});
