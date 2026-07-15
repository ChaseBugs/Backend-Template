const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');

test('PostgreSQL migrations exist and order idempotency is scoped per user', { timeout: 10000 }, async () => {
  const client = new Client({
    connectionString: process.env.INTEGRATION_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ecommerce',
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  try {
    const required = await client.query(`
      SELECT table_schema, table_name FROM information_schema.tables
      WHERE (table_schema, table_name) IN (
        ('auth','users'), ('product','products'), ('product','catalog_products'),
        ('product','catalog_variants'), ('inventory','inventories'),
        ('order','orders'), ('order','coupons'), ('order','coupon_redemptions'),
        ('payment','payments'), ('payment','refunds'),
        ('payment','settlement_adjustments'), ('delivery','delivery_groups'),
        ('notification','notifications'), ('review','reviews'),
        ('review','review_rating_outbox'), ('admin','audit_logs')
      )
    `);
    assert.equal(required.rowCount, 16, 'run scripts/init-all.sh before integration tests');

    await client.query('BEGIN');
    const userA = randomUUID();
    const userB = randomUUID();
    const key = `integration:${randomUUID()}`;
    const insert = `INSERT INTO "order".orders
      (id, saga_id, user_id, status, total_amount, shipping_fee, discount_amount, final_amount, shipping_address, idempotency_key)
      VALUES ($1, $2, $3, 'PENDING', 1000, 0, 0, 1000, '{}', $4)`;
    await client.query(insert, [randomUUID(), randomUUID(), userA, key]);
    await assert.rejects(
      client.query(insert, [randomUUID(), randomUUID(), userA, key]),
      (error) => error?.code === '23505',
    );
    // A failed statement aborts a PostgreSQL transaction; use a savepoint to
    // continue and prove that a second user may reuse the same client key.
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await client.query(insert, [randomUUID(), randomUUID(), userA, key]);
    await client.query(insert, [randomUUID(), randomUUID(), userB, key]);
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});

test('marketplace catalog shares variants while seller offers keep independent price and stock identity', { timeout: 10000 }, async () => {
  const client = new Client({
    connectionString: process.env.INTEGRATION_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/ecommerce',
    connectionTimeoutMillis: 3000,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const categoryId = randomUUID();
    const catalogId = randomUUID();
    const variantId = randomUUID();
    const sellerA = randomUUID();
    const sellerB = randomUUID();
    const sku = `SHARED-${randomUUID()}`;
    await client.query(
      `INSERT INTO product.categories (id, name, slug) VALUES ($1, 'Integration', $2)`,
      [categoryId, `integration-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO product.catalog_products (id, category_id, canonical_name, brand, gtin)
       VALUES ($1,$2,'Shared phone','Brand',$3)`,
      [catalogId, categoryId, String(Date.now()).padStart(13, '0').slice(-13)],
    );
    await client.query(
      `INSERT INTO product.catalog_variants (id, catalog_product_id, variant_key, variant_name, attributes)
       VALUES ($1,$2,$3,'Black 256GB','{"color":"black","storage":"256GB"}')`,
      [variantId, catalogId, randomUUID().replaceAll('-', '')],
    );
    const insertOffer = `INSERT INTO product.products
      (id, catalog_variant_id, agent_id, category_id, name, price, sku, condition, status)
      VALUES ($1,$2,$3,$4,'Seller presentation',$5,$6,$7,'ACTIVE')`;
    await client.query(insertOffer, [randomUUID(), variantId, sellerA, categoryId, 900000, sku, 'NEW']);
    await client.query(insertOffer, [randomUUID(), variantId, sellerB, categoryId, 880000, sku, 'NEW']);
    const offers = await client.query(
      `SELECT agent_id, price FROM product.products WHERE catalog_variant_id = $1 ORDER BY price`, [variantId],
    );
    assert.deepEqual(offers.rows.map((row) => Number(row.price)), [880000, 900000]);

    await client.query('SAVEPOINT duplicate_sku');
    await assert.rejects(
      client.query(insertOffer, [randomUUID(), variantId, sellerA, categoryId, 850000, sku, 'USED_GOOD']),
      (error) => error?.code === '23505',
    );
    await client.query('ROLLBACK TO SAVEPOINT duplicate_sku');
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});
