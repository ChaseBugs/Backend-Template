#!/usr/bin/env node
'use strict';

/**
 * Demo data seed script.
 * Inserts into PostgreSQL (write DB) and MongoDB (read model).
 * Run: node scripts/seed-demo.js
 *
 * Prerequisites: PostgreSQL + MongoDB must be running and schemas initialised.
 */

const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

// ──────────────────────────────────────────────
// Config (override via env)
// ──────────────────────────────────────────────
const PG_URL   = process.env.DATABASE_URL   ?? 'postgresql://postgres:postgres@localhost:5432/ecommerce';
const MONGO_URL = process.env.MONGODB_URI ?? process.env.MONGODB_URL ?? 'mongodb://localhost:27017/ecommerce_read';
const DEMO_ASSET_BASE_URL = (process.env.DEMO_ASSET_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const SALT_ROUNDS = 10;

const log  = (msg) => console.log(`  ✓  ${msg}`);
const warn = (msg) => console.warn(`  !  ${msg}`);

// ──────────────────────────────────────────────
// ID buckets (pre-generate so we can cross-ref)
// ──────────────────────────────────────────────
const ids = {
  // users
  superAdmin:  randomUUID(),
  admin:       randomUUID(),
  agent1User:  randomUUID(),
  agent2User:  randomUUID(),
  user1:       randomUUID(),
  user2:       randomUUID(),
  user3:       randomUUID(),

  // agent profiles
  agent1: randomUUID(),
  agent2: randomUUID(),

  // categories
  catElectronics: randomUUID(),
  catClothing:    randomUUID(),
  catFood:        randomUUID(),

  // products — agent 1 (electronics)
  prod1: randomUUID(),  // Galaxy S25 Ultra
  prod2: randomUUID(),  // Sony WH-1000XM5
  prod3: randomUUID(),  // AirPods Pro

  // products — agent 2 (clothing + food)
  prod4: randomUUID(),  // 나이키 에어맥스
  prod5: randomUUID(),  // 패딩 점퍼
  prod6: randomUUID(),  // 견과류 세트
};

// ──────────────────────────────────────────────
// Seed data definitions
// ──────────────────────────────────────────────
async function hashPw(pw) { return bcrypt.hash(pw, SALT_ROUNDS); }

async function buildUsers() {
  const [superAdminHash, adminHash, agentHash, userHash] = await Promise.all([
    hashPw('SuperAdmin1!'),
    hashPw('Admin1234!'),
    hashPw('Agent1234!'),
    hashPw('User1234!'),
  ]);
  return [
    { id: ids.superAdmin, email: 'superadmin@demo.com', password_hash: superAdminHash, role: 'super-admin', first_name: '시스템',  last_name: '관리자', phone: '010-0000-0001' },
    { id: ids.admin,      email: 'admin@demo.com',      password_hash: adminHash,      role: 'admin',       first_name: '플랫폼',  last_name: '어드민', phone: '010-0000-0002' },
    { id: ids.agent1User, email: 'agent1@demo.com',     password_hash: agentHash,      role: 'agent',       first_name: '김',      last_name: '판매자', phone: '010-1111-0001' },
    { id: ids.agent2User, email: 'agent2@demo.com',     password_hash: agentHash,      role: 'agent',       first_name: '이',      last_name: '셀러',   phone: '010-2222-0001' },
    { id: ids.user1,      email: 'user1@demo.com',      password_hash: userHash,       role: 'user',        first_name: '박',      last_name: '고객',   phone: '010-3333-0001' },
    { id: ids.user2,      email: 'user2@demo.com',      password_hash: userHash,       role: 'user',        first_name: '최',      last_name: '구매자', phone: '010-4444-0001' },
    { id: ids.user3,      email: 'user3@demo.com',      password_hash: userHash,       role: 'user',        first_name: '정',      last_name: '소비자', phone: '010-5555-0001' },
  ];
}

const agentProfiles = [
  {
    id: ids.agent1, user_id: ids.agent1User,
    business_name: '테크마트', business_number: '123-45-67890',
    commission_rate: 5.00, approval_status: 'APPROVED',
    approved_by: ids.admin, approved_at: new Date(),
  },
  {
    id: ids.agent2, user_id: ids.agent2User,
    business_name: '패션월드', business_number: '987-65-43210',
    commission_rate: 7.00, approval_status: 'APPROVED',
    approved_by: ids.admin, approved_at: new Date(),
  },
];

const agentShippingPolicies = [
  { agent_id: ids.agent1, base_shipping_fee: 3000, free_shipping_threshold: 50000, remote_area_fee: 3000, supported_couriers: ['CJ대한통운', '한진택배'], default_courier: 'CJ대한통운' },
  { agent_id: ids.agent2, base_shipping_fee: 2500, free_shipping_threshold: 30000, remote_area_fee: 4000, supported_couriers: ['우체국', '로젠택배'],    default_courier: '우체국' },
];

const categories = [
  { id: ids.catElectronics, name: '전자제품', slug: 'electronics', sort_order: 1 },
  { id: ids.catClothing,    name: '의류',     slug: 'clothing',    sort_order: 2 },
  { id: ids.catFood,        name: '식품',     slug: 'food',        sort_order: 3 },
];

const products = [
  {
    id: ids.prod1, agent_id: ids.agent1, category_id: ids.catElectronics,
    name: 'Samsung Galaxy S25 Ultra', slug: 'samsung-galaxy-s25-ultra',
    description: '삼성 최신 플래그십 스마트폰. S-Pen 내장, 200MP 카메라, Snapdragon 8 Elite 탑재.',
    price: 1599000, compare_price: 1799000, sku: 'SAM-S25U-256-BLK',
    status: 'ACTIVE', approved_by: ids.admin, approved_at: new Date(),
    weight_g: 228,
  },
  {
    id: ids.prod2, agent_id: ids.agent1, category_id: ids.catElectronics,
    name: 'Sony WH-1000XM5 헤드폰', slug: 'sony-wh1000xm5',
    description: '업계 최고 수준의 노이즈 캔슬링. 최대 30시간 배터리, 멀티포인트 연결 지원.',
    price: 429000, compare_price: 499000, sku: 'SONY-WH1000XM5-BLK',
    status: 'ACTIVE', approved_by: ids.admin, approved_at: new Date(),
    weight_g: 250,
  },
  {
    id: ids.prod3, agent_id: ids.agent1, category_id: ids.catElectronics,
    name: 'Apple AirPods Pro (3세대)', slug: 'apple-airpods-pro-3rd',
    description: '액티브 노이즈 캔슬링, 투명 모드, 공간 음향 지원. H2 칩 탑재 무선 이어폰.',
    price: 359000, compare_price: 389000, sku: 'APPLE-APP3-WHT',
    status: 'ACTIVE', approved_by: ids.admin, approved_at: new Date(),
    weight_g: 51,
  },
  {
    id: ids.prod4, agent_id: ids.agent2, category_id: ids.catClothing,
    name: '나이키 에어맥스 270', slug: 'nike-airmax-270',
    description: '에어백 유닛으로 최대 편안함을 제공하는 나이키 라이프스타일 슈즈. 사이즈: 240~290mm.',
    price: 159000, compare_price: 189000, sku: 'NIKE-AM270-BLK-270',
    status: 'ACTIVE', approved_by: ids.admin, approved_at: new Date(),
    weight_g: 800,
  },
  {
    id: ids.prod5, agent_id: ids.agent2, category_id: ids.catClothing,
    name: '남성 롱 패딩 점퍼', slug: 'mens-long-padding-jumper',
    description: '구스다운 90% 충전재 사용. 방풍·방수 처리. 색상: 블랙/네이비. 사이즈: M~XXL.',
    price: 189000, compare_price: 250000, sku: 'FASHION-PADDINGLNG-BLK-L',
    status: 'ACTIVE', approved_by: ids.admin, approved_at: new Date(),
    weight_g: 1200,
  },
  {
    id: ids.prod6, agent_id: ids.agent2, category_id: ids.catFood,
    name: '프리미엄 유기농 견과류 세트', slug: 'premium-organic-nuts-set',
    description: '아몬드·캐슈넛·호두·마카다미아 혼합. 무방부제, 무염 가공. 500g 대용량 패키지.',
    price: 45000, compare_price: 55000, sku: 'FOOD-NUTS-MIX-500G',
    status: 'ACTIVE', approved_by: ids.admin, approved_at: new Date(),
    weight_g: 500,
  },
];

products.forEach((product) => {
  product.catalog_product_id = randomUUID();
  product.catalog_variant_id = randomUUID();
  product.condition = 'NEW';
});

const inventories = [
  { product_id: ids.prod1, agent_id: ids.agent1, quantity_available: 50,  quantity_reserved: 0, low_stock_threshold: 5 },
  { product_id: ids.prod2, agent_id: ids.agent1, quantity_available: 80,  quantity_reserved: 0, low_stock_threshold: 10 },
  { product_id: ids.prod3, agent_id: ids.agent1, quantity_available: 120, quantity_reserved: 0, low_stock_threshold: 15 },
  { product_id: ids.prod4, agent_id: ids.agent2, quantity_available: 200, quantity_reserved: 0, low_stock_threshold: 20 },
  { product_id: ids.prod5, agent_id: ids.agent2, quantity_available: 60,  quantity_reserved: 0, low_stock_threshold: 10 },
  { product_id: ids.prod6, agent_id: ids.agent2, quantity_available: 300, quantity_reserved: 0, low_stock_threshold: 30 },
];

// ──────────────────────────────────────────────
// MongoDB read-model documents (denormalised)
// ──────────────────────────────────────────────
const categoryNameMap = {
  [ids.catElectronics]: '전자제품',
  [ids.catClothing]:    '의류',
  [ids.catFood]:        '식품',
};

const agentNameMap = {
  [ids.agent1]: '테크마트',
  [ids.agent2]: '패션월드',
};

const stockMap = {};
inventories.forEach(inv => { stockMap[inv.product_id] = inv.quantity_available; });

const productImages = {
  [ids.prod1]: [`${DEMO_ASSET_BASE_URL}/product-placeholder.svg`],
  [ids.prod2]: [`${DEMO_ASSET_BASE_URL}/product-placeholder.svg`],
  [ids.prod3]: [`${DEMO_ASSET_BASE_URL}/product-placeholder.svg`],
  [ids.prod4]: [`${DEMO_ASSET_BASE_URL}/product-placeholder.svg`],
  [ids.prod5]: [`${DEMO_ASSET_BASE_URL}/product-placeholder.svg`],
  [ids.prod6]: [`${DEMO_ASSET_BASE_URL}/product-placeholder.svg`],
};

function buildMongoProducts() {
  return products.map(p => ({
    _id:          p.id,
    catalogVariantId: p.catalog_variant_id,
    sku:          p.sku,
    condition:    p.condition,
    agentId:      p.agent_id,
    agentName:    agentNameMap[p.agent_id],
    categoryId:   p.category_id,
    categoryName: categoryNameMap[p.category_id],
    name:         p.name,
    description:  p.description,
    price:        p.price,
    comparePrice: p.compare_price,
    brand:        p.agent_id === ids.agent1 ? p.name.split(' ')[0] : undefined,
    tags:         [],
    images:       productImages[p.id] ?? [],
    status:       'ACTIVE',
    stock:        stockMap[p.id] ?? 0,
    rating:       { average: 0, count: 0 },
    viewCount:    0,
    createdAt:    new Date(),
    updatedAt:    new Date(),
  }));
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
async function main() {
  const pool = new Pool({ connectionString: PG_URL });
  const mongo = new MongoClient(MONGO_URL);

  try {
    await mongo.connect();
    const db = mongo.db();
    console.log('\n=== Demo Data Seed ===\n');

    // ── PostgreSQL ──────────────────────────────
    console.log('── PostgreSQL ──');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if already seeded
      const { rows } = await client.query("SELECT COUNT(*) FROM auth.users WHERE email LIKE '%@demo.com'");
      if (parseInt(rows[0].count) > 0) {
        warn('Demo data already exists. Run with FORCE=1 to re-seed.');
        if (!process.env.FORCE) {
          await client.query('ROLLBACK');
          return;
        }
        // Clean up existing demo data
        await client.query("DELETE FROM auth.users WHERE email LIKE '%@demo.com'");
        await client.query("DELETE FROM product.categories WHERE slug IN ('electronics','clothing','food')");
        log('Existing demo data removed.');
      }

      // Users
      const users = await buildUsers();
      for (const u of users) {
        await client.query(
          `INSERT INTO auth.users (id, email, password_hash, role, first_name, last_name, phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [u.id, u.email, u.password_hash, u.role, u.first_name, u.last_name, u.phone],
        );
      }
      log(`${users.length} users inserted`);

      // Agent profiles
      for (const ap of agentProfiles) {
        await client.query(
          `INSERT INTO auth.agent_profiles
             (id, user_id, business_name, business_number, commission_rate, approval_status, approved_by, approved_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [ap.id, ap.user_id, ap.business_name, ap.business_number,
           ap.commission_rate, ap.approval_status, ap.approved_by, ap.approved_at],
        );
      }
      log('2 agent profiles inserted (APPROVED)');

      // Agent shipping policies
      for (const sp of agentShippingPolicies) {
        await client.query(
          `INSERT INTO auth.agent_shipping_policies
             (agent_id, base_shipping_fee, free_shipping_threshold, remote_area_fee, supported_couriers, default_courier)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [sp.agent_id, sp.base_shipping_fee, sp.free_shipping_threshold,
           sp.remote_area_fee, sp.supported_couriers, sp.default_courier],
        );
      }
      log('2 shipping policies inserted');

      // Categories
      for (const cat of categories) {
        await client.query(
          `INSERT INTO product.categories (id, name, slug, sort_order) VALUES ($1,$2,$3,$4)`,
          [cat.id, cat.name, cat.slug, cat.sort_order],
        );
      }
      log('3 categories inserted');

      // Global marketplace hierarchy: canonical item -> variant -> seller offer.
      for (const p of products) {
        await client.query(
          `INSERT INTO product.catalog_products
             (id, category_id, canonical_name, brand, description, status)
           VALUES ($1,$2,$3,$4,$5,'ACTIVE')`,
          [p.catalog_product_id, p.category_id, p.name, p.name.split(' ')[0], p.description],
        );
        await client.query(
          `INSERT INTO product.catalog_variants
             (id, catalog_product_id, variant_key, variant_name, attributes)
           VALUES ($1,$2,md5('{}'),$3,'{}'::jsonb)`,
          [p.catalog_variant_id, p.catalog_product_id, p.name],
        );
      }
      log('6 canonical catalog products and variants inserted');

      // Seller offers
      for (const p of products) {
        await client.query(
          `INSERT INTO product.products
             (id, agent_id, category_id, catalog_variant_id, name, slug, description, price, compare_price, sku, condition, status, approved_by, approved_at, weight_g)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [p.id, p.agent_id, p.category_id, p.catalog_variant_id, p.name, p.slug, p.description,
           p.price, p.compare_price, p.sku, p.condition, p.status, p.approved_by, p.approved_at, p.weight_g],
        );
      }
      log('6 seller offers inserted (ACTIVE)');

      // Inventories
      for (const inv of inventories) {
        await client.query(
          `INSERT INTO inventory.inventories
             (product_id, agent_id, quantity_available, quantity_reserved, low_stock_threshold)
           VALUES ($1,$2,$3,$4,$5)`,
          [inv.product_id, inv.agent_id, inv.quantity_available, inv.quantity_reserved, inv.low_stock_threshold],
        );
      }
      log('6 inventory records inserted');

      await client.query(
        `INSERT INTO "order".coupons
           (code, discount_type, discount_value, min_order_amount, max_discount_amount, starts_at, expires_at, usage_limit, per_user_limit)
         VALUES ('WELCOME10', 'PERCENT', 10, 10000, 20000, NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 year', 1000, 1)
         ON CONFLICT (code) DO UPDATE SET is_active = TRUE, updated_at = NOW()`,
      );
      log('Demo coupon WELCOME10 inserted');

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // ── MongoDB ────────────────────────────────
    console.log('\n── MongoDB ──');

    const productsColl = db.collection('products');
    const mongoProducts = buildMongoProducts();

    // Upsert each product document
    for (const doc of mongoProducts) {
      await productsColl.replaceOne({ _id: doc._id }, doc, { upsert: true });
    }
    log(`${mongoProducts.length} product documents upserted`);

    // ── Done ───────────────────────────────────
    console.log('\n=== Seed complete ===\n');
    console.log('Demo accounts:');
    console.log('  super-admin  superadmin@demo.com / SuperAdmin1!');
    console.log('  admin        admin@demo.com      / Admin1234!');
    console.log('  agent 1      agent1@demo.com     / Agent1234!  (테크마트 — 전자제품)');
    console.log('  agent 2      agent2@demo.com     / Agent1234!  (패션월드 — 의류/식품)');
    console.log('  user 1       user1@demo.com      / User1234!');
    console.log('  user 2       user2@demo.com      / User1234!');
    console.log('  user 3       user3@demo.com      / User1234!');
    console.log('  coupon       WELCOME10 (10%, max KRW 20,000)');
    console.log('\nStart UI:  cd apps/web-demo && node src/server.js');

  } finally {
    await pool.end();
    await mongo.close();
  }
}

main().catch(err => {
  console.error('\n[SEED ERROR]', err.message);
  process.exit(1);
});
