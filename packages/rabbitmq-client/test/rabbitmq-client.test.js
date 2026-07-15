const test = require('node:test');
const assert = require('node:assert/strict');
const { RabbitMQClient } = require('../dist/index.js');

function channelStub() {
  const calls = [];
  let delivery;
  return {
    calls,
    assertExchange: async (...args) => { calls.push(['exchange', ...args]); },
    assertQueue: async (...args) => { calls.push(['queue', ...args]); },
    bindQueue: async (...args) => { calls.push(['binding', ...args]); },
    prefetch: async (...args) => { calls.push(['prefetch', ...args]); },
    consume: async (queue, callback) => { calls.push(['consume', queue]); delivery = callback; },
    publish: () => true,
    sendToQueue: () => true,
    ack: (msg) => { calls.push(['ack', msg]); },
    nack: (msg, all, requeue) => { calls.push(['nack', msg, all, requeue]); },
    close: async () => {}, on: () => {},
    deliver: (msg) => delivery(msg),
  };
}

function message(retryCount = 0) {
  return {
    content: Buffer.from('{"id":1}'),
    properties: { headers: { 'x-retry-count': retryCount } },
    fields: {},
  };
}

test('replays exchanges, queues, bindings, and consumers on a replacement channel', async () => {
  const client = new RabbitMQClient({ url: 'amqp://test' });
  const first = channelStub();
  client.channel = first;
  await client.assertExchange('notifications', 'topic', { durable: true });
  await client.assertQueue('email', { deadLetterExchange: 'notifications.dlx' });
  await client.bindQueue('email', 'notifications', 'email.*');
  await client.consume('email', async () => {}, 7, 4);

  const replacement = channelStub();
  await client.restoreTopology(replacement);
  assert.deepEqual(replacement.calls.map((call) => call[0]), ['exchange', 'queue', 'binding', 'prefetch', 'consume']);
  assert.deepEqual(replacement.calls.find((call) => call[0] === 'prefetch'), ['prefetch', 7]);
});

test('acks a failed delivery only after retry publication is broker-confirmed', async () => {
  const client = new RabbitMQClient({ url: 'amqp://test' });
  const channel = channelStub();
  let confirm;
  channel.sendToQueue = (_queue, _content, options, callback) => {
    channel.calls.push(['retry', options.headers['x-retry-count']]);
    confirm = callback;
    return true;
  };
  client.channel = channel;
  await client.consume('jobs', async () => { throw new Error('temporary'); }, 1, 3);

  const pending = channel.deliver(message());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(channel.calls.filter((call) => call[0] === 'ack'), []);
  assert.deepEqual(channel.calls.find((call) => call[0] === 'retry'), ['retry', 1]);
  confirm(null);
  await pending;
  assert.equal(channel.calls.filter((call) => call[0] === 'ack').length, 1);
});

test('requeues the original when retry publication is not confirmed', async () => {
  const client = new RabbitMQClient({ url: 'amqp://test' });
  const channel = channelStub();
  channel.sendToQueue = (_queue, _content, _options, callback) => { callback(new Error('channel closed')); return false; };
  client.channel = channel;
  await client.consume('jobs', async () => { throw new Error('temporary'); });
  const msg = message();
  await channel.deliver(msg);
  assert.deepEqual(channel.calls.find((call) => call[0] === 'nack'), ['nack', msg, false, true]);
  assert.equal(channel.calls.filter((call) => call[0] === 'ack').length, 0);
});

test('dead-letters a delivery after the bounded retry count', async () => {
  const client = new RabbitMQClient({ url: 'amqp://test' });
  const channel = channelStub();
  client.channel = channel;
  await client.consume('jobs', async () => { throw new Error('permanent'); }, 1, 3);
  const msg = message(3);
  await channel.deliver(msg);
  assert.deepEqual(channel.calls.find((call) => call[0] === 'nack'), ['nack', msg, false, false]);
});
