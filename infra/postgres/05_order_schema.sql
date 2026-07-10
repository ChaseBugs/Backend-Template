SET search_path TO "order";

CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,                    -- ref: auth.users.id
  status            VARCHAR(30) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN (
                      'PENDING','CONFIRMED','PAYMENT_PENDING','PAID',
                      'PARTIALLY_SHIPPED','SHIPPED','COMPLETED','CANCELLED','REFUNDED'
                    )),
  total_amount      INTEGER NOT NULL,                  -- KRW
  shipping_amount   INTEGER NOT NULL DEFAULT 0,
  discount_amount   INTEGER NOT NULL DEFAULT 0,
  shipping_address  JSONB NOT NULL,
  note              TEXT,
  idempotency_key   VARCHAR(255) UNIQUE,
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
  option_values  JSONB,
  unit_price     INTEGER NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  subtotal       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saga_states (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID UNIQUE NOT NULL REFERENCES "order".orders(id) ON DELETE CASCADE,
  status       VARCHAR(30) NOT NULL DEFAULT 'STARTED'
               CHECK (status IN (
                 'STARTED','INVENTORY_RESERVED','PAYMENT_INITIATED',
                 'COMPLETED','COMPENSATION_STARTED','COMPENSATED','FAILED'
               )),
  payload      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user       ON "order".orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON "order".orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created    ON "order".orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON "order".order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_agent ON "order".order_items(agent_id);
CREATE INDEX IF NOT EXISTS idx_saga_order        ON "order".saga_states(order_id);
