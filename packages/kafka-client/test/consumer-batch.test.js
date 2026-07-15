const test = require('node:test');
const assert = require('node:assert/strict');
const { KafkaConsumer } = require('../dist/consumer.js');

function harness() {
  const state = { commits: [], dlq: [], runConfig: null };
  const rawConsumer = {
    run: async (config) => { state.runConfig = config; },
    commitOffsets: async (offsets) => { state.commits.push(offsets); },
    connect: async () => {}, subscribe: async () => {}, disconnect: async () => {},
  };
  const producer = {
    connect: async () => {}, disconnect: async () => {},
    send: async (record) => { state.dlq.push(record); },
  };
  const kafka = { consumer: () => rawConsumer, producer: () => producer };
  return { state, consumer: new KafkaConsumer(kafka, { groupId: 'g', topics: [], dlqTopic: 'test.dlq', maxRetries: 3 }) };
}

function batchPayload() {
  return {
    batch: {
      topic: 'orders', partition: 2,
      messages: [
        { offset: '10', key: Buffer.from('a'), value: Buffer.from('{"n":1}'), headers: {} },
        { offset: '11', key: Buffer.from('b'), value: Buffer.from('{"n":2}'), headers: {} },
      ],
    },
    heartbeat: async () => {}, resolveOffset: () => {}, pause: () => () => {},
    commitOffsetsIfNecessary: async () => {}, uncommittedOffsets: () => ({}),
    isRunning: () => true, isStale: () => false,
  };
}

test('batch consumer commits the next offset only after handler success', async () => {
  const { state, consumer } = harness();
  let handled = false;
  await consumer.runBatch(async (messages) => { assert.equal(messages.length, 2); handled = true; });
  assert.equal(state.commits.length, 0);
  await state.runConfig.eachBatch(batchPayload());
  assert.equal(handled, true);
  assert.deepEqual(state.commits, [[{ topic: 'orders', partition: 2, offset: '12' }]]);
  assert.equal(state.dlq.length, 0);
});

test('failed batches remain uncommitted until the retry limit, then move atomically to DLQ', async () => {
  const { state, consumer } = harness();
  await consumer.runBatch(async () => { throw new Error('projection failed'); });
  const payload = batchPayload();

  await assert.rejects(() => state.runConfig.eachBatch(payload), /projection failed/);
  await assert.rejects(() => state.runConfig.eachBatch(payload), /projection failed/);
  assert.equal(state.commits.length, 0);
  assert.equal(state.dlq.length, 0);

  await state.runConfig.eachBatch(payload);
  assert.equal(state.dlq.length, 1);
  assert.equal(state.dlq[0].topic, 'test.dlq');
  assert.equal(state.dlq[0].messages.length, 2);
  assert.equal(state.dlq[0].messages[0].headers['source-offset'], '10');
  assert.deepEqual(state.commits, [[{ topic: 'orders', partition: 2, offset: '12' }]]);
});

test('stale batches are ignored without handler execution or commit', async () => {
  const { state, consumer } = harness();
  let calls = 0;
  await consumer.runBatch(async () => { calls += 1; });
  const payload = batchPayload();
  payload.isStale = () => true;
  await state.runConfig.eachBatch(payload);
  assert.equal(calls, 0);
  assert.equal(state.commits.length, 0);
});
