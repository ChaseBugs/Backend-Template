SET search_path TO delivery;

CREATE TABLE IF NOT EXISTS delivery_groups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL,                      -- ref: order.orders.id
  user_id         UUID NOT NULL,                      -- buyer; ref: auth.users.id
  payment_id      UUID NOT NULL,                      -- ref: payment.payments.id
  agent_id        UUID NOT NULL,                      -- ref: auth.agent_profiles.id
  status          VARCHAR(25) NOT NULL DEFAULT 'PREPARING'
                  CHECK (status IN (
                    'PREPARING','SHIPPED','IN_TRANSIT','DELIVERED',
                    'FAILED','RETURN_REQUESTED','RETURNED','CANCELLED'
                  )),
  shipping_fee    INTEGER NOT NULL DEFAULT 0,
  courier_name    VARCHAR(100),
  tracking_number VARCHAR(100),
  shipped_at      TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  returned_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE delivery.delivery_groups DROP CONSTRAINT IF EXISTS delivery_groups_status_check;
ALTER TABLE delivery.delivery_groups ADD CONSTRAINT delivery_groups_status_check CHECK (status IN (
  'PREPARING','SHIPPED','IN_TRANSIT','DELIVERED','FAILED','RETURN_REQUESTED','RETURNED','CANCELLED'
));

CREATE TABLE IF NOT EXISTS delivery_group_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_group_id UUID NOT NULL REFERENCES delivery.delivery_groups(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL,                    -- ref: product.products.id
  quantity          INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS return_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_group_id UUID NOT NULL REFERENCES delivery.delivery_groups(id),
  order_id          UUID NOT NULL,                    -- ref: order.orders.id
  user_id           UUID NOT NULL,                    -- ref: auth.users.id
  reason            TEXT NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','REJECTED','COMPLETED')),
  refund_amount     INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_groups_order  ON delivery.delivery_groups(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_groups_agent  ON delivery.delivery_groups(agent_id);
CREATE INDEX IF NOT EXISTS idx_delivery_groups_status ON delivery.delivery_groups(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_group_order_agent ON delivery.delivery_groups(order_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_dg_items_group         ON delivery.delivery_group_items(delivery_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dg_item_product ON delivery.delivery_group_items(delivery_group_id, product_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_dg     ON delivery.return_requests(delivery_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_return_request_delivery_group ON delivery.return_requests(delivery_group_id);
