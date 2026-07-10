SET search_path TO payment;

CREATE TABLE IF NOT EXISTS payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID UNIQUE NOT NULL,             -- ref: order.orders.id
  user_id           UUID NOT NULL,                    -- ref: auth.users.id
  idempotency_key   VARCHAR(255) UNIQUE NOT NULL,
  method            VARCHAR(30) NOT NULL
                    CHECK (method IN ('CARD','BANK_TRANSFER','VIRTUAL_ACCOUNT','POINT')),
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','COMPLETED','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
  amount            INTEGER NOT NULL,
  refunded_amount   INTEGER NOT NULL DEFAULT 0,
  pg_transaction_id VARCHAR(255),
  pg_response       JSONB,
  failed_reason     TEXT,
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_settlements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID NOT NULL,                       -- ref: auth.agent_profiles.id
  order_id       UUID NOT NULL,                       -- ref: order.orders.id
  payment_id     UUID NOT NULL REFERENCES payment.payments(id),
  gross_amount   INTEGER NOT NULL,                    -- sum of agent's order items
  commission     INTEGER NOT NULL,
  net_amount     INTEGER NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','SETTLED','CANCELLED')),
  settled_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_order        ON payment.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user         ON payment.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_idempotency  ON payment.payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_settlements_agent     ON payment.agent_settlements(agent_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status    ON payment.agent_settlements(status);
