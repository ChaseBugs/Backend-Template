SET search_path TO ads;

-- Sponsored-placement ad campaigns. One campaign promotes one product for one
-- agent. Spend is charged per click (CPC) directly on this row rather than via
-- a separate event log — click/impression volume for a single-platform demo
-- doesn't warrant a time-series table, and the counters here are sufficient
-- for the dashboard tiles (impressions, clicks, CTR, spend).
CREATE TABLE IF NOT EXISTS campaigns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL,                     -- ref: auth.agent_profiles.id
  product_id        UUID NOT NULL,                     -- ref: product.products.id
  cost_per_click    INTEGER NOT NULL CHECK (cost_per_click > 0),
  daily_budget      INTEGER NOT NULL CHECK (daily_budget > 0),
  total_budget      INTEGER NOT NULL CHECK (total_budget > 0),
  spent_total       INTEGER NOT NULL DEFAULT 0 CHECK (spent_total >= 0),
  spent_today       INTEGER NOT NULL DEFAULT 0 CHECK (spent_today >= 0),
  spend_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  impression_count  INTEGER NOT NULL DEFAULT 0,
  click_count       INTEGER NOT NULL DEFAULT 0,
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
                     CHECK (status IN ('PENDING_APPROVAL','ACTIVE','PAUSED','REJECTED','COMPLETED')),
  rejection_reason  TEXT,
  approved_by       UUID,
  approved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_agent   ON ads.campaigns(agent_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status  ON ads.campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_product ON ads.campaigns(product_id);
-- Sponsorship lookups filter to ACTIVE campaigns for a batch of product ids.
CREATE INDEX IF NOT EXISTS idx_campaigns_product_active ON ads.campaigns(product_id) WHERE status = 'ACTIVE';
