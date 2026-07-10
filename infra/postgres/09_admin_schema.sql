SET search_path TO admin;

CREATE TABLE IF NOT EXISTS audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     UUID NOT NULL,                         -- ref: auth.users.id
  actor_role   VARCHAR(20) NOT NULL,
  action       VARCHAR(100) NOT NULL,
  resource     VARCHAR(100) NOT NULL,
  resource_id  VARCHAR(255),
  old_value    JSONB,
  new_value    JSONB,
  ip_address   INET,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commission_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID,                              -- NULL = global default rule
  category_id      UUID,                              -- NULL = applies to all categories
  rate             DECIMAL(5,2) NOT NULL,
  effective_from   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until  TIMESTAMPTZ,
  created_by       UUID NOT NULL,                     -- ref: auth.users.id
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor    ON admin.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON admin.audit_logs(resource, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created  ON admin.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_agent    ON admin.commission_rules(agent_id);
