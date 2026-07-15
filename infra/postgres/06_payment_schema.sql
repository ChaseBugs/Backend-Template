SET search_path TO payment;

CREATE TABLE IF NOT EXISTS payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID UNIQUE NOT NULL,             -- ref: order.orders.id
  saga_id           UUID NOT NULL,
  user_id           UUID NOT NULL,                    -- ref: auth.users.id
  idempotency_key   VARCHAR(255) UNIQUE NOT NULL,
  method            VARCHAR(30) NOT NULL
                    CHECK (method IN ('CARD','BANK_TRANSFER','VIRTUAL_ACCOUNT','POINT')),
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','COMPLETED','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
  amount            INTEGER NOT NULL,
  refunded_amount   INTEGER NOT NULL DEFAULT 0,
  transaction_id    VARCHAR(255),
  pg_response       JSONB,
  failure_reason    TEXT,
  refund_amount     INTEGER,
  paid_at           TIMESTAMPTZ,
  refunded_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_settlements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID NOT NULL,                       -- ref: auth.agent_profiles.id
  order_id       UUID NOT NULL,                       -- ref: order.orders.id
  payment_id     UUID NOT NULL REFERENCES payment.payments(id),
  gross_amount   INTEGER NOT NULL,                    -- sum of agent's order items
  commission_rate DECIMAL(5,2) NOT NULL,
  commission_amount INTEGER NOT NULL,
  net_amount     INTEGER NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','PROCESSING','COMPLETED','HELD','CANCELLED')),
  settled_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refunds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     UUID NOT NULL REFERENCES payment.payments(id),
  order_id       UUID NOT NULL,
  reference_id   VARCHAR(255) UNIQUE NOT NULL,
  agent_id       UUID,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  reason         TEXT NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  gateway_refund_id VARCHAR(255),
  failure_reason TEXT,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_adjustments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id       UUID NOT NULL REFERENCES payment.agent_settlements(id),
  refund_id           UUID NOT NULL REFERENCES payment.refunds(id),
  agent_id             UUID NOT NULL,
  order_id             UUID NOT NULL,
  gross_amount         INTEGER NOT NULL CHECK (gross_amount > 0),
  commission_reversal INTEGER NOT NULL CHECK (commission_reversal >= 0),
  net_amount           INTEGER NOT NULL CHECK (net_amount >= 0),
  status               VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','PROCESSING','COMPLETED','CANCELLED')),
  processed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (settlement_id, refund_id)
);

-- Keep reruns compatible with databases initialized before seller-scoped refunds.
ALTER TABLE payment.refunds ADD COLUMN IF NOT EXISTS agent_id UUID;
ALTER TABLE payment.refunds ADD COLUMN IF NOT EXISTS status VARCHAR(20);
ALTER TABLE payment.refunds ADD COLUMN IF NOT EXISTS gateway_refund_id VARCHAR(255);
ALTER TABLE payment.refunds ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE payment.refunds ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
-- Rows created by older releases represented already-completed local refunds.
UPDATE payment.refunds SET status = 'COMPLETED', completed_at = COALESCE(completed_at, created_at) WHERE status IS NULL;
ALTER TABLE payment.refunds ALTER COLUMN status SET DEFAULT 'PENDING';
ALTER TABLE payment.refunds ALTER COLUMN status SET NOT NULL;
ALTER TABLE payment.refunds DROP CONSTRAINT IF EXISTS refunds_status_check;
ALTER TABLE payment.refunds ADD CONSTRAINT refunds_status_check CHECK (status IN ('PENDING','COMPLETED','FAILED'));

CREATE INDEX IF NOT EXISTS idx_payments_order        ON payment.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user         ON payment.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_idempotency  ON payment.payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_settlements_agent     ON payment.agent_settlements(agent_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status    ON payment.agent_settlements(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_order_agent ON payment.agent_settlements(order_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON payment.refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_agent ON payment.settlement_adjustments(agent_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_status ON payment.settlement_adjustments(status);
