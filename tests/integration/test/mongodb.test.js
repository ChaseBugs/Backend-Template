const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { MongoClient } = require('mongodb');

test('MongoDB read model supports ordered idempotent projection writes', { timeout: 10000 }, async () => {
  const client = new MongoClient(
    process.env.INTEGRATION_MONGODB_URI ?? 'mongodb://localhost:27017/ecommerce_read',
    { serverSelectionTimeoutMS: 3000 },
  );
  const collectionName = `integration_projection_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.connect();
    const database = client.db();
    await database.command({ ping: 1 });
    const collection = database.collection(collectionName);
    const aggregateId = randomUUID();

    await collection.bulkWrite([
      { updateOne: { filter: { _id: aggregateId }, update: { $set: { status: 'PENDING', version: 1 } }, upsert: true } },
      { updateOne: { filter: { _id: aggregateId }, update: { $set: { status: 'COMPLETED', version: 2 } }, upsert: true } },
    ], { ordered: true });
    await collection.updateOne(
      { _id: aggregateId, version: { $lte: 2 } },
      { $set: { status: 'COMPLETED', version: 2 } },
      { upsert: false },
    );

    assert.deepEqual(
      await collection.findOne({ _id: aggregateId }, { projection: { _id: 0, status: 1, version: 1 } }),
      { status: 'COMPLETED', version: 2 },
    );
    assert.equal(await collection.countDocuments({ _id: aggregateId }), 1);
  } finally {
    await client.db().dropCollection(collectionName).catch(() => {});
    await client.close();
  }
});
