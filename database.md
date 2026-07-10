# Database 설계 & 구축 가이드
## eCommerce Backend — 오프라인(On-Premise) 전용

---

## 목차
1. [데이터베이스 전략 개요 (CQRS)](#1-데이터베이스-전략-개요-cqrs)
2. [PostgreSQL 16 — Write DB](#2-postgresql-16--write-db)
3. [MongoDB 7 — Read DB](#3-mongodb-7--read-db)
4. [Redis 7 Cluster — 캐시 / 세션 / 분산 락 / 장바구니](#4-redis-7-cluster--캐시--세션--분산-락--장바구니)
5. [OpenSearch 2 — 풀텍스트 검색](#5-opensearch-2--풀텍스트-검색)
6. [오프라인 설치 절차](#6-오프라인-설치-절차)
7. [데이터 동기화 흐름 (Kafka 기반)](#7-데이터-동기화-흐름-kafka-기반)
8. [마이그레이션 전략](#8-마이그레이션-전략)
9. [백업 & 복구](#9-백업--복구)

---

## 1. 데이터베이스 전략 개요 (CQRS)

```
[Command (쓰기 요청)]                    [Query (읽기 요청)]
        │                                        │
        ▼                                        ▼
  PostgreSQL 16                          ① Redis 캐시 확인
  Schema-per-Service                            │ miss
  ─────────────────                             ▼
  schema: auth                          ② MongoDB 7 조회
  schema: product                          (비정규화 문서)
  schema: order                                 │
  schema: payment          Kafka 이벤트         │
  schema: inventory    ──────────────▶ [Sync Worker]
  schema: delivery                              │
  schema: notification        ┌─────────────────┤
  schema: admin               ▼                 ▼
                         MongoDB upsert   OpenSearch update
                              +
                         Redis 캐시 무효화

[검색 요청]
     │
     ▼
① Redis 검색 캐시 → ② OpenSearch 풀텍스트 검색
```

### Schema-per-Service 원칙

> **핵심 규칙: 서비스는 자신의 스키마에만 접근한다.**
> 크로스 스키마 FK는 존재하지 않는다. 다른 서비스의 ID는 UUID 컬럼으로만 저장하고,
> 데이터 일관성은 Kafka 이벤트를 통한 **최종 일관성(Eventual Consistency)** 으로 보장한다.

```
PostgreSQL 서버 1대 / 데이터베이스 1개 (ecommerce)
├── schema: auth         ← auth-service 전용 DB 유저(auth_svc)만 접근
├── schema: product      ← product-service 전용 (product_svc)
├── schema: inventory    ← inventory-service 전용 (inventory_svc)
├── schema: order        ← order-service 전용 (order_svc)
├── schema: payment      ← payment-service 전용 (payment_svc)
├── schema: delivery     ← delivery-service 전용 (delivery_svc)
├── schema: notification ← notification-service 전용 (notification_svc)
└── schema: admin        ← admin-service 전용 (admin_svc) + 각 스키마 읽기 권한
```

### 데이터베이스별 역할

| DB | 역할 | 접근 서비스 |
|----|------|-----------|
| PostgreSQL 16 | Write(Command) — Schema-per-Service, 서비스별 격리 | 각 서비스가 자기 스키마만 접근 |
| MongoDB 7 | Read(Query) — 비정규화 문서, 서비스 경계 없이 조회 최적화 | product(read), order(history), sync-worker |
| Redis 7 Cluster | 캐시 / 세션 / 분산 락 / 장바구니 / 재고 선차감 | 모든 서비스 |
| OpenSearch 2 | 풀텍스트 검색 / 복합 필터링 | search-service, sync-worker |

---

## 2. PostgreSQL 16 — Write DB (Schema-per-Service)

### 2-1. 오프라인 설치 (Ubuntu/Debian 기준)

```bash
# 오프라인 환경: .deb 패키지를 미리 다운로드하여 전송
sudo dpkg -i postgresql-16_*.deb libpq5_*.deb postgresql-client-16_*.deb

sudo systemctl enable postgresql
sudo systemctl start postgresql

sudo -u postgres psql
```

### 2-2. 데이터베이스 & 스키마 & 유저 초기화

각 서비스는 **전용 DB 유저**를 가지며, 자신의 스키마에만 접근 권한을 갖는다.
크로스 스키마 `REFERENCES`(FK)는 존재하지 않는다.

```sql
-- ============================================================
-- ecommerce 데이터베이스 생성
-- ============================================================
CREATE DATABASE ecommerce;
\c ecommerce

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ── 스키마 생성 ─────────────────────────────────────────────
CREATE SCHEMA auth;
CREATE SCHEMA product;
CREATE SCHEMA inventory;
CREATE SCHEMA "order";
CREATE SCHEMA payment;
CREATE SCHEMA delivery;
CREATE SCHEMA notification;
CREATE SCHEMA admin;

-- ── 서비스별 전용 DB 유저 생성 ──────────────────────────────
CREATE USER auth_svc         WITH PASSWORD 'auth_pass';
CREATE USER product_svc      WITH PASSWORD 'product_pass';
CREATE USER inventory_svc    WITH PASSWORD 'inventory_pass';
CREATE USER order_svc        WITH PASSWORD 'order_pass';
CREATE USER payment_svc      WITH PASSWORD 'payment_pass';
CREATE USER delivery_svc     WITH PASSWORD 'delivery_pass';
CREATE USER notification_svc WITH PASSWORD 'notification_pass';
CREATE USER admin_svc        WITH PASSWORD 'admin_pass';
CREATE USER sync_worker      WITH PASSWORD 'sync_pass';

-- ── 스키마 소유권 & 권한 부여 ───────────────────────────────
-- auth_svc: auth 스키마 전용
GRANT USAGE, CREATE ON SCHEMA auth TO auth_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO auth_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO auth_svc;

-- product_svc: product 스키마 전용
GRANT USAGE, CREATE ON SCHEMA product TO product_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA product TO product_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA product GRANT ALL ON TABLES TO product_svc;

-- inventory_svc: inventory 스키마 전용
GRANT USAGE, CREATE ON SCHEMA inventory TO inventory_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA inventory TO inventory_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory GRANT ALL ON TABLES TO inventory_svc;

-- order_svc: order 스키마 전용
GRANT USAGE, CREATE ON SCHEMA "order" TO order_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA "order" TO order_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA "order" GRANT ALL ON TABLES TO order_svc;

-- payment_svc: payment 스키마 전용
GRANT USAGE, CREATE ON SCHEMA payment TO payment_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA payment TO payment_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA payment GRANT ALL ON TABLES TO payment_svc;

-- delivery_svc: delivery 스키마 전용
GRANT USAGE, CREATE ON SCHEMA delivery TO delivery_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA delivery TO delivery_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA delivery GRANT ALL ON TABLES TO delivery_svc;

-- notification_svc: notification 스키마 전용
GRANT USAGE, CREATE ON SCHEMA notification TO notification_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA notification TO notification_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification GRANT ALL ON TABLES TO notification_svc;

-- admin_svc: admin 스키마 쓰기 + 나머지 스키마 읽기 전용
GRANT USAGE, CREATE ON SCHEMA admin TO admin_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA admin TO admin_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT ALL ON TABLES TO admin_svc;

GRANT USAGE ON SCHEMA auth, product, inventory, "order", payment, delivery, notification TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA auth         TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA product      TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA inventory    TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA "order"      TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA payment      TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA delivery     TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA notification TO admin_svc;

-- sync_worker: 모든 스키마 읽기 전용 (Kafka 이벤트 보상용)
GRANT USAGE ON SCHEMA auth, product, inventory, "order", payment, delivery TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA auth      TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA product   TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA inventory TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA "order"   TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA payment   TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA delivery  TO sync_worker;
```

### 2-3. postgresql.conf 성능 튜닝

```ini
# /etc/postgresql/16/main/postgresql.conf

# 연결 (서비스 × 풀 사이즈 기준 산정)
max_connections = 300

# 메모리 (서버 RAM의 25%)
shared_buffers = 2GB
effective_cache_size = 6GB
work_mem = 16MB
maintenance_work_mem = 256MB

# WAL — 복제 및 내구성
wal_level = replica
max_wal_senders = 5
wal_keep_size = 1GB

# 체크포인트
checkpoint_completion_target = 0.9
checkpoint_timeout = 10min

# 로깅 (느린 쿼리 감지)
log_min_duration_statement = 500
log_line_prefix = '%t [%p] %u@%d '
```

### 2-4. 스키마별 DDL 전체

> **규칙**: 다른 스키마 테이블을 참조할 때는 FK 대신 UUID 컬럼으로만 저장한다.
> `-- ref: auth.users.id` 형태의 주석으로 의도를 명시한다.

---

#### `auth` 스키마 — auth-service 전용

```sql
-- ────────────────────────────────────────────────────────────
-- auth.users: 회원 계정 (4 역할)
-- ────────────────────────────────────────────────────────────
CREATE TABLE auth.users (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(20)  NOT NULL
                  CHECK (role IN ('super-admin', 'admin', 'agent', 'user')),
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  phone           VARCHAR(20),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_users_email     ON auth.users(email);
CREATE INDEX idx_auth_users_role      ON auth.users(role);
CREATE INDEX idx_auth_users_is_active ON auth.users(is_active);

-- ────────────────────────────────────────────────────────────
-- auth.agent_profiles: 에이전트(판매자) 프로필
-- ────────────────────────────────────────────────────────────
CREATE TABLE auth.agent_profiles (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name    VARCHAR(255) NOT NULL,
  business_number  VARCHAR(50)  UNIQUE NOT NULL,
  bank_name        VARCHAR(100),
  bank_account     VARCHAR(50),
  account_holder   VARCHAR(100),
  commission_rate  DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  approval_status  VARCHAR(20)  NOT NULL DEFAULT 'PENDING'
                   CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_by      UUID         REFERENCES auth.users(id),  -- 같은 auth 스키마이므로 FK 허용
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auth_agent_user_id        ON auth.agent_profiles(user_id);
CREATE INDEX idx_auth_agent_approval       ON auth.agent_profiles(approval_status);

-- ────────────────────────────────────────────────────────────
-- auth.agent_shipping_policies: 에이전트별 배송 정책
-- ────────────────────────────────────────────────────────────
CREATE TABLE auth.agent_shipping_policies (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                UUID    UNIQUE NOT NULL REFERENCES auth.agent_profiles(id) ON DELETE CASCADE,
  base_shipping_fee       INTEGER NOT NULL DEFAULT 3000,
  free_shipping_threshold INTEGER,                         -- NULL = 무료배송 없음
  remote_area_fee         INTEGER NOT NULL DEFAULT 3000,
  supported_couriers      TEXT[]  NOT NULL DEFAULT '{}',
  default_courier         VARCHAR(100),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── updated_at 트리거 (auth 스키마) ─────────────────────────
CREATE OR REPLACE FUNCTION auth.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER trg_auth_users_upd
  BEFORE UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION auth.update_updated_at();
CREATE TRIGGER trg_auth_agent_upd
  BEFORE UPDATE ON auth.agent_profiles
  FOR EACH ROW EXECUTE FUNCTION auth.update_updated_at();
```

---

#### `product` 스키마 — product-service 전용

```sql
-- ────────────────────────────────────────────────────────────
-- product.categories: 상품 카테고리 (트리 구조)
-- ────────────────────────────────────────────────────────────
CREATE TABLE product.categories (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(200) NOT NULL,
  parent_id  UUID         REFERENCES product.categories(id),
  depth      INTEGER      NOT NULL DEFAULT 1,   -- 1: 대분류, 2: 중분류, 3: 소분류
  sort_order INTEGER      NOT NULL DEFAULT 0,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_categories_parent ON product.categories(parent_id);

-- ────────────────────────────────────────────────────────────
-- product.products: 상품 (CQRS Write Side)
-- ────────────────────────────────────────────────────────────
CREATE TABLE product.products (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID         NOT NULL,      -- ref: auth.agent_profiles.id
  category_id      UUID         NOT NULL REFERENCES product.categories(id),
  name             VARCHAR(500) NOT NULL,
  description      TEXT,
  price            DECIMAL(12,2) NOT NULL CHECK (price >= 0),
  brand            VARCHAR(200),
  thumbnail_url    VARCHAR(1000),
  image_urls       TEXT[]        NOT NULL DEFAULT '{}',
  tags             TEXT[]        NOT NULL DEFAULT '{}',
  approval_status  VARCHAR(20)   NOT NULL DEFAULT 'PENDING'
                   CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_by      UUID,         -- ref: auth.users.id
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_product_products_agent_id  ON product.products(agent_id);
CREATE INDEX idx_product_products_category  ON product.products(category_id);
CREATE INDEX idx_product_products_approval  ON product.products(approval_status);
CREATE INDEX idx_product_products_active    ON product.products(is_active);
CREATE INDEX idx_product_products_agent_act ON product.products(agent_id, is_active, approval_status);

CREATE OR REPLACE FUNCTION product.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER trg_product_upd
  BEFORE UPDATE ON product.products
  FOR EACH ROW EXECUTE FUNCTION product.update_updated_at();
```

---

#### `inventory` 스키마 — inventory-service 전용

```sql
CREATE TABLE inventory.inventory (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID    UNIQUE NOT NULL,   -- ref: product.products.id
  agent_id            UUID    NOT NULL,           -- ref: auth.agent_profiles.id
  total_quantity      INTEGER NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  reserved_quantity   INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_inv_reserved CHECK (reserved_quantity <= total_quantity)
);

CREATE INDEX idx_inv_agent_id  ON inventory.inventory(agent_id);
-- 재고 부족 모니터링 부분 인덱스
CREATE INDEX idx_inv_low_stock ON inventory.inventory(agent_id, total_quantity)
  WHERE total_quantity <= low_stock_threshold;

CREATE OR REPLACE FUNCTION inventory.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER trg_inventory_upd
  BEFORE UPDATE ON inventory.inventory
  FOR EACH ROW EXECUTE FUNCTION inventory.update_updated_at();
```

---

#### `order` 스키마 — order-service 전용

```sql
-- ────────────────────────────────────────────────────────────
-- order.orders: 주문 (SAGA 상태 머신)
-- ────────────────────────────────────────────────────────────
CREATE TABLE "order".orders (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL,     -- ref: auth.users.id
  status           VARCHAR(30)  NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','CONFIRMED','PAID','FULFILLING','COMPLETED','CANCELLED')),
  total_amount     DECIMAL(12,2) NOT NULL CHECK (total_amount >= 0),
  total_shipping   DECIMAL(12,2) NOT NULL DEFAULT 0,
  shipping_address JSONB         NOT NULL,
  idempotency_key  VARCHAR(255)  UNIQUE NOT NULL,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_orders_user_id    ON "order".orders(user_id);
CREATE INDEX idx_order_orders_status     ON "order".orders(status);
CREATE INDEX idx_order_orders_created_at ON "order".orders(created_at DESC);

-- ────────────────────────────────────────────────────────────
-- order.order_items: 주문 항목 (주문 시점 데이터 스냅샷)
-- ────────────────────────────────────────────────────────────
CREATE TABLE "order".order_items (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID         NOT NULL REFERENCES "order".orders(id) ON DELETE CASCADE,
  product_id   UUID         NOT NULL,     -- ref: product.products.id
  agent_id     UUID         NOT NULL,     -- ref: auth.agent_profiles.id
  product_name VARCHAR(500) NOT NULL,     -- 주문 시점 스냅샷 (상품명 변경 무관)
  unit_price   DECIMAL(12,2) NOT NULL,    -- 주문 시점 스냅샷 (가격 변경 무관)
  quantity     INTEGER       NOT NULL CHECK (quantity > 0),
  shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal     DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id   ON "order".order_items(order_id);
CREATE INDEX idx_order_items_agent_id   ON "order".order_items(agent_id);
CREATE INDEX idx_order_items_product_id ON "order".order_items(product_id);

CREATE OR REPLACE FUNCTION "order".update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER trg_order_upd
  BEFORE UPDATE ON "order".orders
  FOR EACH ROW EXECUTE FUNCTION "order".update_updated_at();
```

---

#### `payment` 스키마 — payment-service 전용

```sql
CREATE TABLE payment.payments (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID         NOT NULL,     -- ref: order.orders.id
  user_id           UUID         NOT NULL,     -- ref: auth.users.id
  idempotency_key   VARCHAR(255) UNIQUE NOT NULL,
  amount            DECIMAL(12,2) NOT NULL,
  status            VARCHAR(30)  NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED','REFUNDED','PARTIAL_REFUNDED')),
  payment_method    VARCHAR(50),
  pg_transaction_id VARCHAR(255),
  pg_response       JSONB,
  completed_at      TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_payments_order_id ON payment.payments(order_id);
CREATE INDEX idx_payment_payments_user_id  ON payment.payments(user_id);
CREATE INDEX idx_payment_payments_status   ON payment.payments(status);

CREATE TABLE payment.refunds (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   UUID         NOT NULL REFERENCES payment.payments(id),
  order_id     UUID         NOT NULL,     -- ref: order.orders.id
  amount       DECIMAL(12,2) NOT NULL,
  reason       TEXT,
  status       VARCHAR(30)  NOT NULL DEFAULT 'PENDING'
               CHECK (status IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  requested_by UUID         NOT NULL,    -- ref: auth.users.id
  processed_by UUID,                     -- ref: auth.users.id
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_refunds_payment_id ON payment.refunds(payment_id);

-- ── 에이전트 정산
CREATE TABLE payment.agent_settlements (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID         NOT NULL,    -- ref: auth.agent_profiles.id
  order_id          UUID         NOT NULL,    -- ref: order.orders.id
  payment_id        UUID         NOT NULL REFERENCES payment.payments(id),
  gross_amount      DECIMAL(12,2) NOT NULL,
  commission_rate   DECIMAL(5,2)  NOT NULL,
  commission_amount DECIMAL(12,2) NOT NULL,
  net_amount        DECIMAL(12,2) NOT NULL,
  status            VARCHAR(30)  NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','PROCESSING','COMPLETED','HELD')),
  settled_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_payment_settle_order_agent ON payment.agent_settlements(order_id, agent_id);
CREATE INDEX idx_payment_settle_agent_id ON payment.agent_settlements(agent_id);
CREATE INDEX idx_payment_settle_status   ON payment.agent_settlements(status);

CREATE OR REPLACE FUNCTION payment.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER trg_payment_upd
  BEFORE UPDATE ON payment.payments FOR EACH ROW EXECUTE FUNCTION payment.update_updated_at();
CREATE TRIGGER trg_refund_upd
  BEFORE UPDATE ON payment.refunds  FOR EACH ROW EXECUTE FUNCTION payment.update_updated_at();
```

---

#### `delivery` 스키마 — delivery-service 전용

```sql
-- ────────────────────────────────────────────────────────────
-- delivery.delivery_groups: 에이전트별 독립 배송 단위
-- ────────────────────────────────────────────────────────────
CREATE TABLE delivery.delivery_groups (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID         NOT NULL,    -- ref: order.orders.id
  agent_id        UUID         NOT NULL,    -- ref: auth.agent_profiles.id
  status          VARCHAR(30)  NOT NULL DEFAULT 'PREPARING'
                  CHECK (status IN (
                    'PREPARING', 'SHIPPED', 'IN_TRANSIT',
                    'DELIVERED', 'FAILED', 'RETURN_REQUESTED', 'RETURNED'
                  )),
  shipping_fee    DECIMAL(12,2) NOT NULL DEFAULT 0,
  courier_name    VARCHAR(100),
  tracking_number VARCHAR(255),
  shipped_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  returned_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_delivery_dg_order_id     ON delivery.delivery_groups(order_id);
CREATE INDEX idx_delivery_dg_agent_id     ON delivery.delivery_groups(agent_id);
CREATE INDEX idx_delivery_dg_status       ON delivery.delivery_groups(status);
CREATE INDEX idx_delivery_dg_agent_status ON delivery.delivery_groups(agent_id, status);

-- ── 반품 요청
CREATE TABLE delivery.return_requests (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_group_id UUID         NOT NULL REFERENCES delivery.delivery_groups(id),
  order_id          UUID         NOT NULL,    -- ref: order.orders.id
  user_id           UUID         NOT NULL,    -- ref: auth.users.id
  reason            TEXT         NOT NULL,
  status            VARCHAR(30)  NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED','COMPLETED')),
  processed_by      UUID,                     -- ref: auth.users.id
  refund_amount     DECIMAL(12,2),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_delivery_rr_dg_id   ON delivery.return_requests(delivery_group_id);
CREATE INDEX idx_delivery_rr_user_id ON delivery.return_requests(user_id);

CREATE OR REPLACE FUNCTION delivery.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

CREATE TRIGGER trg_delivery_dg_upd
  BEFORE UPDATE ON delivery.delivery_groups
  FOR EACH ROW EXECUTE FUNCTION delivery.update_updated_at();
CREATE TRIGGER trg_delivery_rr_upd
  BEFORE UPDATE ON delivery.return_requests
  FOR EACH ROW EXECUTE FUNCTION delivery.update_updated_at();
```

---

#### `notification` 스키마 — notification-service 전용

```sql
CREATE TABLE notification.notifications (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL,    -- ref: auth.users.id
  type       VARCHAR(100) NOT NULL,    -- 'ORDER_CONFIRMED', 'DELIVERY_SHIPPED', etc.
  title      VARCHAR(500) NOT NULL,
  body       TEXT         NOT NULL,
  metadata   JSONB,
  is_read    BOOLEAN      NOT NULL DEFAULT FALSE,
  sent_at    TIMESTAMPTZ,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user_unread ON notification.notifications(user_id, is_read);
CREATE INDEX idx_notif_created     ON notification.notifications(created_at DESC);
```

---

#### `admin` 스키마 — admin-service 전용

```sql
-- ────────────────────────────────────────────────────────────
-- admin.audit_logs: super-admin / admin 액션 감사 이력
-- ────────────────────────────────────────────────────────────
CREATE TABLE admin.audit_logs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID         NOT NULL,    -- ref: auth.users.id
  actor_role    VARCHAR(20)  NOT NULL,
  action        VARCHAR(200) NOT NULL,    -- 'AGENT_APPROVED', 'PRODUCT_REJECTED', ...
  resource_type VARCHAR(100),
  resource_id   VARCHAR(255),
  before_state  JSONB,
  after_state   JSONB,
  ip_address    INET,
  request_id    VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_actor     ON admin.audit_logs(actor_id);
CREATE INDEX idx_admin_audit_action    ON admin.audit_logs(action);
CREATE INDEX idx_admin_audit_created   ON admin.audit_logs(created_at DESC);
CREATE INDEX idx_admin_audit_resource  ON admin.audit_logs(resource_type, resource_id);
```

### 2-5. 서비스별 DB 연결 문자열

각 서비스는 자신의 전용 유저로 연결하고, `search_path`를 자신의 스키마로 고정한다.

```typescript
// 예시: order-service .env
DATABASE_URL=postgresql://order_svc:order_pass@localhost:5432/ecommerce?schema=order

// apps/order-service/src/infrastructure/db/pool.ts
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// 연결 시 search_path 고정 — 다른 스키마 접근 불가
pool.on('connect', (client) => {
  client.query('SET search_path TO "order"');
});
```

```
서비스               DB 유저           search_path    접근 가능 스키마
──────────────────────────────────────────────────────────────────
auth-service         auth_svc          auth           auth
product-service      product_svc       product        product
inventory-service    inventory_svc     inventory      inventory
order-service        order_svc         order          order
payment-service      payment_svc       payment        payment
delivery-service     delivery_svc      delivery       delivery
notification-service notification_svc  notification   notification
admin-service        admin_svc         admin          admin + 전체 스키마 SELECT
sync-worker          sync_worker       -              전체 스키마 SELECT
```

### 2-6. Read Replica 설정 (스트리밍 복제)

```bash
# Primary 서버 — postgresql.conf 추가
wal_level = replica
max_wal_senders = 5
wal_keep_size = 1GB

# Primary — pg_hba.conf 추가 (replica 서버 IP 허용)
# TYPE  DATABASE        USER            ADDRESS                 METHOD
host    replication     replicator      192.168.1.102/32        md5

# Primary — replica 전용 유저 생성
sudo -u postgres psql -c "CREATE USER replicator WITH REPLICATION PASSWORD 'replica_pass';"

# ─────────────────────────────────────────────────────────────
# Replica 서버에서 실행
# ─────────────────────────────────────────────────────────────
sudo systemctl stop postgresql
sudo -u postgres rm -rf /var/lib/postgresql/16/main/*

# Primary에서 베이스 백업 수신
sudo -u postgres pg_basebackup \
  -h 192.168.1.101 \           # Primary IP
  -U replicator \
  -D /var/lib/postgresql/16/main \
  -P -Xs -R                    # -R: recovery.conf 자동 생성

sudo systemctl start postgresql
```

---

## 3. MongoDB 7 — Read DB

CQRS의 Query 쪽을 담당한다. 조회 시 JOIN 없이 필요한 데이터를 한 번에 가져올 수 있도록 **비정규화(Denormalized)** 문서로 저장한다.

### 3-1. 오프라인 설치

```bash
# .tgz 바이너리를 서버에 전송하여 설치
tar -xzf mongodb-linux-x86_64-7.0.tgz
sudo mv mongodb-linux-x86_64-7.0 /opt/mongodb

# 데이터 디렉토리
sudo mkdir -p /data/mongodb /var/log/mongodb
sudo chown -R mongodb:mongodb /data/mongodb /var/log/mongodb

# /etc/mongod.conf
cat > /etc/mongod.conf << 'EOF'
storage:
  dbPath: /data/mongodb
  wiredTiger:
    engineConfig:
      cacheSizeGB: 2        # RAM의 약 50%
net:
  port: 27017
  bindIp: 127.0.0.1,192.168.1.101
replication:
  replSetName: "rs0"
systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
EOF

# systemd 서비스
sudo systemctl enable mongod
sudo systemctl start mongod

# Replica Set 초기화 (3-node 기준)
mongosh --eval "rs.initiate({
  _id: 'rs0',
  members: [
    { _id: 0, host: '192.168.1.101:27017', priority: 2 },
    { _id: 1, host: '192.168.1.102:27017', priority: 1 },
    { _id: 2, host: '192.168.1.103:27017', priority: 1 }
  ]
})"
```

### 3-2. 컬렉션 설계

#### `products` 컬렉션 — 상품 목록/상세 조회용

```javascript
// 상품 1건의 도큐먼트 구조
// PostgreSQL에서 Kafka → Sync Worker가 이 형태로 저장
{
  _id: "product-uuid",

  // 기본 정보
  productId:   "uuid",
  agentId:     "uuid",
  agentName:   "에이전트 상호명",        // 비정규화 — 조회 시 JOIN 불필요

  // 상품 정보
  name:         "나이키 에어맥스 2024",
  description:  "상품 설명 전문",
  price:        129000,
  brand:        "나이키",
  thumbnailUrl: "/images/products/uuid.jpg",
  imageUrls:    ["/images/..."],
  tags:         ["운동화", "스포츠"],

  // 카테고리 (비정규화)
  category: {
    id:   "cat-uuid",
    name: "운동화",
    path: ["패션", "신발", "운동화"]    // 브레드크럼 표시용
  },

  // 평점 (리뷰 서비스에서 업데이트)
  rating: {
    average: 4.5,
    count:   128
  },

  // 재고 요약 (inventory-service에서 업데이트)
  inventory: {
    available: 50,
    inStock:   true
  },

  // 배송 정책 요약 (주문 전 배송비 표시용)
  shippingPolicy: {
    baseFee:              3000,
    freeShippingThreshold: 50000,   // null이면 무료배송 없음
    remoteAreaFee:        3000
  },

  approvalStatus: "APPROVED",
  isActive:       true,
  createdAt:      ISODate("..."),
  updatedAt:      ISODate("...")
}
```

```javascript
// 인덱스 생성
db.products.createIndex({ productId: 1 }, { unique: true });
db.products.createIndex({ agentId: 1 });
db.products.createIndex({ "category.id": 1 });
db.products.createIndex({ price: 1 });
db.products.createIndex({ "rating.average": -1 });
db.products.createIndex({ "inventory.inStock": 1 });
db.products.createIndex({ approvalStatus: 1, isActive: 1 });
// 에이전트 본인 상품 목록
db.products.createIndex({ agentId: 1, isActive: 1, approvalStatus: 1 });
// 복합 필터링 쿼리 최적화
db.products.createIndex({ "category.id": 1, price: 1, "inventory.inStock": 1 });
```

#### `orders` 컬렉션 — 주문 이력 조회용

```javascript
// 구매자가 "내 주문 목록"을 볼 때 한 번의 조회로 모든 정보 반환
{
  _id: "order-uuid",

  orderId: "uuid",
  userId:  "uuid",
  status:  "FULFILLING",

  items: [
    {
      productId:   "uuid",
      productName: "나이키 에어맥스 2024",   // 주문 시점 스냅샷
      thumbnailUrl: "/images/...",
      agentId:     "uuid",
      agentName:   "에이전트 상호명",
      quantity:    2,
      unitPrice:   129000,
      shippingFee: 3000
    }
  ],

  // 배송 그룹 현황 (delivery-service에서 업데이트)
  deliveryGroups: [
    {
      groupId:        "dg-uuid",
      agentId:        "uuid",
      agentName:      "에이전트 상호명",
      status:         "SHIPPED",
      courierName:    "CJ대한통운",
      trackingNumber: "123456789012",
      shippedAt:      ISODate("..."),
      deliveredAt:    null,
      items: [
        { productId: "uuid", productName: "...", quantity: 2 }
      ]
    }
  ],

  totalAmount:   261000,
  totalShipping: 3000,

  shippingAddress: {
    recipientName: "홍길동",
    phone:         "010-1234-5678",
    zipCode:       "06234",
    address:       "서울시 강남구 테헤란로 123",
    detailAddress: "456호"
  },

  createdAt: ISODate("...")
}
```

```javascript
// 인덱스 생성
db.orders.createIndex({ orderId: 1 }, { unique: true });
db.orders.createIndex({ userId: 1, createdAt: -1 });       // 내 주문 목록
db.orders.createIndex({ "deliveryGroups.agentId": 1 });   // 에이전트별 주문 조회
db.orders.createIndex({ status: 1 });
db.orders.createIndex({ createdAt: -1 });
```

#### `users` 컬렉션 — 어드민 사용자 검색용

```javascript
{
  _id: "user-uuid",
  userId:    "uuid",
  email:     "user@example.com",
  role:      "agent",
  firstName: "길동",
  lastName:  "홍",
  isActive:  true,

  // agent 역할인 경우
  agentProfile: {
    businessName:    "홍길동 쇼핑",
    approvalStatus:  "APPROVED",
    commissionRate:  5.0
  },

  createdAt: ISODate("...")
}
```

```javascript
db.users.createIndex({ userId: 1 }, { unique: true });
db.users.createIndex({ email: 1 });
db.users.createIndex({ role: 1 });
db.users.createIndex({ "agentProfile.approvalStatus": 1 });
```

---

## 4. Redis 7 Cluster — 캐시 / 세션 / 분산 락 / 장바구니

### 4-1. 오프라인 Cluster 설치 (6-node: 3 Master + 3 Replica)

```bash
# Redis 소스 또는 바이너리를 서버에 전송
tar -xzf redis-7.2.4.tar.gz
cd redis-7.2.4 && make && sudo make install

# 각 노드 디렉토리 생성 (같은 서버에서 포트로 분리하는 경우)
for port in 7001 7002 7003 7004 7005 7006; do
  mkdir -p /etc/redis/$port /var/lib/redis/$port /var/log/redis

  cat > /etc/redis/$port/redis.conf << EOF
port $port
cluster-enabled yes
cluster-config-file /var/lib/redis/$port/nodes.conf
cluster-node-timeout 5000
appendonly yes
appendfsync everysec
dir /var/lib/redis/$port
logfile /var/log/redis/redis-$port.log
maxmemory 2gb
maxmemory-policy allkeys-lru
requirepass your_redis_password
masterauth your_redis_password
EOF

  # systemd 서비스
  cat > /etc/systemd/system/redis-$port.service << EOF
[Unit]
Description=Redis $port
After=network.target

[Service]
ExecStart=/usr/local/bin/redis-server /etc/redis/$port/redis.conf
ExecStop=/usr/local/bin/redis-cli -p $port -a your_redis_password shutdown
Restart=always
User=redis

[Install]
WantedBy=multi-user.target
EOF
done

# 서비스 시작
for port in 7001 7002 7003 7004 7005 7006; do
  sudo systemctl enable redis-$port
  sudo systemctl start redis-$port
done

# 클러스터 초기화 (3 master + 3 replica, 자동 슬롯 분배)
redis-cli --cluster create \
  127.0.0.1:7001 127.0.0.1:7002 127.0.0.1:7003 \
  127.0.0.1:7004 127.0.0.1:7005 127.0.0.1:7006 \
  --cluster-replicas 1 \
  -a your_redis_password
```

### 4-2. Redis Key 설계 및 TTL 정책

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Redis Key 네임스페이스                             │
├──────────────────────────┬──────────────┬──────────┬────────────────────┤
│ Key Pattern              │ 자료구조      │ TTL      │ 용도               │
├──────────────────────────┼──────────────┼──────────┼────────────────────┤
│ session:{userId}         │ String(JSON) │ 15분     │ 액세스 토큰 세션    │
│ refresh:{userId}         │ String       │ 7일      │ 리프레시 토큰      │
│ product:{productId}      │ String(JSON) │ 1시간    │ 상품 상세 캐시     │
│ products:list:{hash}     │ String(JSON) │ 10분     │ 상품 목록 캐시     │
│ search:{queryHash}       │ String(JSON) │ 5분      │ 검색 결과 캐시     │
│ search:popular           │ Sorted Set   │ 영구     │ 인기 검색어 순위   │
│ autocomplete:{prefix}    │ Sorted Set   │ 영구     │ 검색 자동완성      │
│ cart:{userId}            │ Hash         │ 30일     │ 장바구니           │
│ stock:{productId}        │ String(Int)  │ 영구     │ 실시간 재고 수량   │
│ lock:{resource}          │ String       │ 5초      │ 분산 락            │
│ ratelimit:{ip}:{window}  │ String(Int)  │ 1분      │ IP Rate Limiting   │
│ agent:policy:{agentId}   │ String(JSON) │ 30분     │ 에이전트 배송 정책 │
│ delivery:{orderId}       │ String(JSON) │ 1시간    │ 배송 현황 캐시     │
└──────────────────────────┴──────────────┴──────────┴────────────────────┘
```

### 4-3. 핵심 데이터 구조 상세

#### 장바구니 (Redis Hash)
```
Key:   cart:{userId}
Type:  Hash
Field: {productId}
Value: JSON 문자열

예시:
HSET cart:user-uuid-1 \
  "prod-uuid-1" '{"productId":"prod-uuid-1","name":"나이키 에어맥스","price":129000,"quantity":2,"agentId":"agent-uuid","thumbnailUrl":"/img/..."}' \
  "prod-uuid-2" '{"productId":"prod-uuid-2","name":"아디다스 티셔츠","price":39000,"quantity":1,"agentId":"agent-uuid-2","thumbnailUrl":"/img/..."}'
EXPIRE cart:user-uuid-1 2592000  -- 30일
```

#### 실시간 재고 (String — Lua Script로 원자 차감)
```
Key:   stock:{productId}
Type:  String (Integer)
TTL:   없음 (영구)

초기화: SET stock:prod-uuid 100
재고 차감 Lua Script:
  -- 원자적으로 재고 확인 후 차감 (Race Condition 없음)
  local current = tonumber(redis.call('get', KEYS[1]))
  if current == nil    then return -1 end  -- 캐시 없음 (DB 재로드 필요)
  if current < ARGV[1] then return -2 end  -- 재고 부족
  return redis.call('decrby', KEYS[1], ARGV[1])
```

#### 분산 락 (재고 차감 외 범용)
```
Key:   lock:{resource}   예: lock:inventory:prod-uuid
Type:  String
TTL:   5000ms (자동 만료)

획득: SET lock:inventory:prod-uuid {uuid_lock_value} NX PX 5000
해제 Lua:
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
```

#### 인기 검색어 (Sorted Set)
```
Key:   search:popular
Type:  Sorted Set
Score: 검색 횟수 (자동 증가)

검색 시마다: ZINCRBY search:popular 1 "나이키"
인기 검색어 Top10: ZREVRANGE search:popular 0 9 WITHSCORES
```

### 4-4. Node.js 연결 설정 (`ioredis`)

```typescript
// packages/redis-client/src/cluster.ts
import { Cluster } from 'ioredis';

export function createRedisCluster() {
  return new Cluster(
    [
      { host: '127.0.0.1', port: 7001 },
      { host: '127.0.0.1', port: 7002 },
      { host: '127.0.0.1', port: 7003 },
    ],
    {
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        // 연결 재시도 (오프라인 환경 네트워크 순간 단절 대비)
        retryStrategy: (times) => Math.min(times * 100, 3000),
      },
      // 클러스터 전체 자동 발견
      enableReadyCheck: true,
      scaleReads: 'slave',  // 읽기는 Replica로 분산
    },
  );
}
```

---

## 5. OpenSearch 2 — 풀텍스트 검색

### 5-1. 오프라인 설치

```bash
# .tar.gz 파일을 서버에 전송
tar -xzf opensearch-2.13.0-linux-x64.tar.gz
sudo mv opensearch-2.13.0 /opt/opensearch

# JVM 힙 설정 (RAM의 50%, 최대 31GB)
echo "-Xms4g" >> /opt/opensearch/config/jvm.options
echo "-Xmx4g" >> /opt/opensearch/config/jvm.options

# opensearch.yml
cat > /opt/opensearch/config/opensearch.yml << 'EOF'
cluster.name: ecommerce-search
node.name: node-1

# 오프라인 단일 노드 (개발) — 운영은 3 node 구성
discovery.type: single-node

# 데이터/로그 경로
path.data: /data/opensearch
path.logs:  /var/log/opensearch

# 네트워크
network.host: 0.0.0.0
http.port: 9200

# 보안 (운영 환경에서는 반드시 활성화)
plugins.security.disabled: false

# 한국어 형태소 분석기 nori 플러그인
# 설치: bin/opensearch-plugin install analysis-nori (오프라인: 플러그인 파일 직접 설치)
EOF

# systemd 서비스
cat > /etc/systemd/system/opensearch.service << 'EOF'
[Unit]
Description=OpenSearch
After=network.target

[Service]
User=opensearch
ExecStart=/opt/opensearch/bin/opensearch
Restart=always
LimitNOFILE=65535
LimitMEMLOCK=infinity

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable opensearch
sudo systemctl start opensearch
```

### 5-2. 인덱스 매핑 — `products`

```bash
# 인덱스 생성 (curl 또는 Node.js 초기화 스크립트로 실행)
curl -X PUT "http://localhost:9200/products" \
  -H 'Content-Type: application/json' \
  -d '{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "korean_analyzer": {
          "type": "custom",
          "tokenizer": "nori_tokenizer",
          "filter": [
            "nori_readingform",
            "lowercase",
            "nori_number"
          ]
        },
        "korean_search_analyzer": {
          "type": "custom",
          "tokenizer": "nori_tokenizer",
          "filter": ["nori_readingform", "lowercase"]
        }
      },
      "tokenizer": {
        "nori_tokenizer": {
          "type": "nori_tokenizer",
          "decompound_mode": "mixed"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "productId":    { "type": "keyword" },
      "agentId":      { "type": "keyword" },
      "agentName":    { "type": "keyword" },

      "name": {
        "type": "text",
        "analyzer": "korean_analyzer",
        "search_analyzer": "korean_search_analyzer",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "description": {
        "type": "text",
        "analyzer": "korean_analyzer",
        "search_analyzer": "korean_search_analyzer"
      },
      "brand":        { "type": "keyword" },
      "tags":         { "type": "keyword" },

      "price":        { "type": "double" },
      "categoryId":   { "type": "keyword" },
      "categoryPath": { "type": "keyword" },

      "rating": {
        "properties": {
          "average": { "type": "float" },
          "count":   { "type": "integer" }
        }
      },

      "inStock":       { "type": "boolean" },
      "approvalStatus":{ "type": "keyword" },
      "isActive":      { "type": "boolean" },
      "createdAt":     { "type": "date" },
      "updatedAt":     { "type": "date" }
    }
  }
}'
```

### 5-3. 검색 쿼리 예시

```typescript
// apps/search-service/src/infrastructure/opensearch/SearchQueryBuilder.ts

interface SearchParams {
  keyword?:    string;
  categoryId?: string;
  minPrice?:   number;
  maxPrice?:   number;
  brand?:      string;
  inStockOnly?: boolean;
  agentId?:    string;          // 에이전트 스토어 페이지용
  sortBy?:     'relevance' | 'price_asc' | 'price_desc' | 'rating' | 'newest';
  searchAfter?: unknown[];      // cursor 기반 페이지네이션
  size?:       number;
}

export function buildSearchQuery(params: SearchParams): object {
  const must: object[]   = [{ term: { isActive: true } }, { term: { approvalStatus: 'APPROVED' } }];
  const filter: object[] = [];

  // 풀텍스트 검색 + 오타 교정 (Fuzzy)
  if (params.keyword) {
    must.push({
      multi_match: {
        query:     params.keyword,
        fields:    ['name^3', 'description', 'brand^2', 'tags^2'],
        type:      'best_fields',
        fuzziness: 'AUTO',      // 오타 1~2자 자동 교정
        operator:  'and',
      },
    });
  }

  if (params.categoryId) filter.push({ term: { categoryId: params.categoryId } });
  if (params.brand)      filter.push({ term: { brand: params.brand } });
  if (params.agentId)    filter.push({ term: { agentId: params.agentId } });
  if (params.inStockOnly) filter.push({ term: { inStock: true } });
  if (params.minPrice || params.maxPrice) {
    filter.push({ range: { price: { gte: params.minPrice, lte: params.maxPrice } } });
  }

  // 정렬
  const sortMap: Record<string, object[]> = {
    relevance:  [{ _score: 'desc' }, { productId: 'asc' }],
    price_asc:  [{ price: 'asc' },   { productId: 'asc' }],
    price_desc: [{ price: 'desc' },  { productId: 'asc' }],
    rating:     [{ 'rating.average': 'desc' }, { productId: 'asc' }],
    newest:     [{ createdAt: 'desc' },        { productId: 'asc' }],
  };

  return {
    query: { bool: { must, filter } },
    // 필수 필드만 반환 (응답 경량화)
    _source: ['productId', 'agentId', 'agentName', 'name', 'price', 'brand',
              'thumbnailUrl', 'rating', 'inStock', 'categoryId'],
    sort:         sortMap[params.sortBy ?? 'relevance'],
    search_after: params.searchAfter,
    size:         params.size ?? 20,
  };
}
```

### 5-4. `users` 인덱스 (어드민 사용자 검색용)

```bash
curl -X PUT "http://localhost:9200/users" \
  -H 'Content-Type: application/json' \
  -d '{
  "settings": { "number_of_shards": 1, "number_of_replicas": 1 },
  "mappings": {
    "properties": {
      "userId":   { "type": "keyword" },
      "email":    { "type": "keyword" },
      "role":     { "type": "keyword" },
      "firstName":{ "type": "text", "analyzer": "korean_analyzer" },
      "lastName": { "type": "text", "analyzer": "korean_analyzer" },
      "businessName": { "type": "text", "analyzer": "korean_analyzer" },
      "approvalStatus": { "type": "keyword" },
      "isActive": { "type": "boolean" },
      "createdAt":{ "type": "date" }
    }
  }
}'
```

---

## 6. 오프라인 설치 절차

### 6-1. 설치 순서

```
① PostgreSQL 16 Primary 설치 → 스키마 초기화 → Replica 설정
② MongoDB 7 설치 → Replica Set 초기화 → 인덱스 생성
③ Redis 7 설치 × 6 → Cluster 초기화 → 재고 캐시 워밍
④ OpenSearch 2 설치 (nori 플러그인 포함) → 인덱스 매핑 생성
⑤ 슈퍼어드민 계정 시드
⑥ 카테고리 초기 데이터 시드
```

### 6-2. 통합 초기화 스크립트

```bash
#!/bin/bash
# scripts/init-all.sh — 전체 DB 초기화 (최초 1회 실행)

set -euo pipefail

echo "=== [1/5] PostgreSQL 스키마 초기화 ==="
PGPASSWORD=$PG_PASSWORD psql -h localhost -U ecommerce -d ecommerce_write \
  -f ./infra/postgres/schema.sql

echo "=== [2/5] PostgreSQL 기초 데이터 시드 ==="
PGPASSWORD=$PG_PASSWORD psql -h localhost -U ecommerce -d ecommerce_write \
  -f ./infra/postgres/seed-categories.sql

echo "=== [3/5] MongoDB 인덱스 생성 ==="
mongosh "mongodb://ecommerce:$MONGO_PASSWORD@localhost:27017/ecommerce_read?authSource=admin" \
  ./infra/mongodb/create-indexes.js

echo "=== [4/5] OpenSearch 인덱스 매핑 생성 ==="
curl -s -X PUT "http://localhost:9200/products" \
  -H 'Content-Type: application/json' \
  -d @./infra/opensearch/products-mapping.json
curl -s -X PUT "http://localhost:9200/users" \
  -H 'Content-Type: application/json' \
  -d @./infra/opensearch/users-mapping.json

echo "=== [5/5] 슈퍼어드민 계정 시드 ==="
node ./scripts/seed-super-admin.js

echo "✅ 전체 DB 초기화 완료"
```

---

## 7. 데이터 동기화 흐름 (Kafka 기반)

PostgreSQL(Write DB) → Kafka 이벤트 → Sync Worker → MongoDB/OpenSearch/Redis 갱신

```
[product-service]
  ProductCreatedEvent / ProductUpdatedEvent 발행
        │
        ▼
   [sync-worker]
        ├── MongoDB products 컬렉션 upsert
        │     (agentName, categoryPath 등 비정규화 데이터 포함하여 저장)
        ├── OpenSearch products 인덱스 upsert
        └── Redis 캐시 무효화
              DELETE product:{productId}
              (다음 조회 시 MongoDB에서 다시 로드 후 캐싱)

[inventory-service]
  InventoryUpdatedEvent 발행 (재고 변경 시)
        │
        ▼
   [sync-worker]
        ├── MongoDB products.inventory.available 업데이트
        ├── MongoDB products.inventory.inStock 업데이트
        ├── OpenSearch products.inStock 업데이트
        └── Redis stock:{productId} 업데이트

[delivery-service]
  DeliveryShippedEvent / DeliveryCompletedEvent 발행
        │
        ▼
   [sync-worker]
        └── MongoDB orders.deliveryGroups 배열 해당 그룹 상태 업데이트
              (구매자가 "내 주문" 조회 시 최신 배송 상태 반영)
```

---

## 8. 마이그레이션 전략

`node-pg-migrate` 를 사용하여 스키마 변경을 버전으로 관리한다.

각 서비스는 **자신의 스키마만** 마이그레이션한다. 마이그레이션 파일은 해당 서비스 디렉토리 안에 위치한다.

```bash
# 각 서비스 디렉토리 내 마이그레이션 실행 예시 (product-service)
DATABASE_URL=postgres://product_svc:product_pass@localhost/ecommerce \
  npx node-pg-migrate up \
  --migrations-dir apps/product-service/migrations \
  --schema product

# auth-service 마이그레이션
DATABASE_URL=postgres://auth_svc:auth_pass@localhost/ecommerce \
  npx node-pg-migrate up \
  --migrations-dir apps/auth-service/migrations \
  --schema auth
```

```javascript
// apps/product-service/migrations/20260710_001_add_product_weight.js
exports.up = (pgm) => {
  // search_path가 product로 고정되어 있으므로 스키마 접두사 불필요
  pgm.addColumn('products', {
    weight_gram: { type: 'integer', notNull: false }
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('products', 'weight_gram');
};
```

```
마이그레이션 파일 위치:
apps/
├── auth-service/migrations/        ← auth 스키마 전용
├── product-service/migrations/     ← product 스키마 전용
├── order-service/migrations/       ← order 스키마 전용
├── payment-service/migrations/     ← payment 스키마 전용
├── inventory-service/migrations/   ← inventory 스키마 전용
├── delivery-service/migrations/    ← delivery 스키마 전용
└── admin-service/migrations/       ← admin 스키마 전용
```

---

## 9. 백업 & 복구

### PostgreSQL 백업

```bash
# 일별 전체 백업 (cron 등록)
# crontab -e
# 0 2 * * * /usr/local/bin/backup-postgres.sh

#!/bin/bash
# scripts/backup-postgres.sh
BACKUP_DIR=/backup/postgres
DATE=$(date +%Y%m%d_%H%M%S)

PGPASSWORD=$PG_PASSWORD pg_dump \
  -h localhost -U ecommerce ecommerce_write \
  -Fc \                                 # 커스텀 포맷 (압축 + 병렬 복구 지원)
  -f "$BACKUP_DIR/ecommerce_$DATE.dump"

# 30일 이상 된 백업 삭제
find $BACKUP_DIR -name "*.dump" -mtime +30 -delete

# 복구
PGPASSWORD=$PG_PASSWORD pg_restore \
  -h localhost -U ecommerce -d ecommerce_write \
  -Fc "$BACKUP_DIR/ecommerce_20260710_020000.dump"
```

### MongoDB 백업

```bash
# 백업
mongodump \
  --uri="mongodb://ecommerce:$MONGO_PASSWORD@localhost:27017/ecommerce_read?authSource=admin" \
  --out=/backup/mongodb/$(date +%Y%m%d)

# 복구
mongorestore \
  --uri="mongodb://ecommerce:$MONGO_PASSWORD@localhost:27017/ecommerce_read?authSource=admin" \
  /backup/mongodb/20260710
```

### Redis 백업

```bash
# AOF(Append Only File) 파티션 백업 — redis.conf에서 appendonly yes 설정 시 자동
# 수동 스냅샷
redis-cli -p 7001 -a $REDIS_PASSWORD BGSAVE

# 백업 파일 복사
cp /var/lib/redis/7001/dump.rdb /backup/redis/dump_$(date +%Y%m%d).rdb
```

### OpenSearch 스냅샷

```bash
# 스냅샷 저장소 등록 (오프라인: 로컬 파일 시스템)
curl -X PUT "http://localhost:9200/_snapshot/backup_repo" \
  -H 'Content-Type: application/json' \
  -d '{"type": "fs", "settings": {"location": "/backup/opensearch"}}'

# 스냅샷 생성
curl -X PUT "http://localhost:9200/_snapshot/backup_repo/snapshot_$(date +%Y%m%d)"

# 복구
curl -X POST "http://localhost:9200/_snapshot/backup_repo/snapshot_20260710/_restore"
```
