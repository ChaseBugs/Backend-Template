const test = require('node:test');
const assert = require('node:assert/strict');
const { validateKafkaEvent, KafkaConsumer } = require('../dist/index.js');

function validEvent(topic = 'order.created') {
  return {
    eventId: 'event-1',
    occurredAt: '2026-07-15T00:00:00.000Z',
    version: 1,
    topic,
    payload: { orderId: 'order-1' },
  };
}

test('accepts a valid versioned Kafka event envelope', () => {
  assert.doesNotThrow(() => validateKafkaEvent(validEvent(), 'order.created'));
});

test('rejects topic spoofing and malformed envelope fields', () => {
  assert.throws(() => validateKafkaEvent(validEvent('payment.completed'), 'order.created'), /Invalid Kafka event/);
  assert.throws(() => validateKafkaEvent({ ...validEvent(), version: 0 }, 'order.created'), /Invalid Kafka event/);
  assert.throws(() => validateKafkaEvent({ ...validEvent(), occurredAt: 'yesterday' }, 'order.created'), /Invalid Kafka event/);
  assert.throws(() => validateKafkaEvent({ ...validEvent(), payload: null }, 'order.created'), /Invalid Kafka event/);
});

test('consumer validates JSON Schema while deserializing', () => {
  const kafka = { consumer: () => ({}) };
  const consumer = new KafkaConsumer(kafka, { groupId: 'g', topics: [] });
  const payload = {
    topic: 'order.created', partition: 0,
    message: { offset: '0', value: Buffer.from(JSON.stringify(validEvent())) },
  };
  assert.deepEqual(consumer.parseMessage(payload), validEvent());
  payload.message.value = Buffer.from(JSON.stringify({ payload: {} }));
  assert.throws(() => consumer.parseMessage(payload), /Invalid Kafka event/);
});
