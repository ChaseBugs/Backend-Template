SET search_path TO "order";

CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saga_id           UUID UNIQUE NOT NULL,
  user_id           UUID NOT NULL,                    -- ref: auth.users.id
  status            VARCHAR(30) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN (
                      'PENDING','PAYMENT_PENDING','PAID','PROCESSING',
                      'PARTIALLY_SHIPPED','SHIPPED','COMPLETED','CANCELLED','REFUNDED'
                    )),
  total_amount      INTEGER NOT NULL,                  -- KRW
  shipping_fee      INTEGER NOT NULL DEFAULT 0,
  discount_amount   INTEGER NOT NULL DEFAULT 0,
  final_amount      INTEGER NOT NULL,
  shipping_address  JSONB NOT NULL,
  payment_id        UUID,
  cancel_reason     TEXT,
  note              TEXT,
  coupon_code       VARCHAR(50),
  idempotency_key   VARCHAR(255) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES "order".orders(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL,                       -- ref: product.products.id
  variant_id     UUID,                                -- ref: product.product_variants.id
  agent_id       UUID NOT NULL,                       -- ref: auth.agent_profiles.id
  product_name   VARCHAR(255) NOT NULL,
  product_image  TEXT,
  option_values  JSONB,
  unit_price     INTEGER NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  subtotal       INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  shipping_fee   INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE "order".order_items ADD COLUMN IF NOT EXISTS shipping_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order".order_items ADD COLUMN IF NOT EXISTS discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order".order_items DROP CONSTRAINT IF EXISTS order_items_discount_amount_bounds;
ALTER TABLE "order".order_items ADD CONSTRAINT order_items_discount_amount_bounds
  CHECK (discount_amount >= 0 AND discount_amount <= subtotal);

CREATE TABLE IF NOT EXISTS saga_states (
  saga_id      UUID PRIMARY KEY,
  order_id     UUID UNIQUE NOT NULL REFERENCES "order".orders(id) ON DELETE CASCADE,
  status       VARCHAR(30) NOT NULL DEFAULT 'STARTED'
               CHECK (status IN (
                 'STARTED','INVENTORY_RESERVED','PAYMENT_INITIATED',
                 'COMPLETED','COMPENSATION_STARTED','COMPENSATED','FAILED'
               )),
  items        JSONB NOT NULL DEFAULT '[]',
  failure_reason TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user       ON "order".orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON "order".orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created    ON "order".orders(created_at DESC);
ALTER TABLE "order".orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
ALTER TABLE "order".orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50);
UPDATE "order".orders SET idempotency_key = 'legacy:' || id::text WHERE idempotency_key IS NULL;
ALTER TABLE "order".orders ALTER COLUMN idempotency_key SET NOT NULL;
ALTER TABLE "order".orders DROP CONSTRAINT IF EXISTS orders_idempotency_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_user_idempotency ON "order".orders(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON "order".order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_agent ON "order".order_items(agent_id);
CREATE INDEX IF NOT EXISTS idx_saga_order        ON "order".saga_states(order_id);

CREATE TABLE IF NOT EXISTS coupons (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                VARCHAR(50) UNIQUE NOT NULL,
  discount_type       VARCHAR(10) NOT NULL CHECK (discount_type IN ('FIXED','PERCENT')),
  discount_value      INTEGER NOT NULL CHECK (discount_value > 0),
  min_order_amount    INTEGER NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_discount_amount INTEGER CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  starts_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  usage_limit         INTEGER CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count          INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  per_user_limit      INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT coupons_uppercase_code CHECK (code = UPPER(code)),
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 100),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

ALTER TABLE "order".coupons DROP CONSTRAINT IF EXISTS coupons_uppercase_code;
ALTER TABLE "order".coupons ADD CONSTRAINT coupons_uppercase_code CHECK (code = UPPER(code));

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id       UUID NOT NULL REFERENCES coupons(id),
  order_id        UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  discount_amount INTEGER NOT NULL CHECK (discount_amount > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user ON coupon_redemptions(coupon_id, user_id);
