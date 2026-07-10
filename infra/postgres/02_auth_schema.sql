SET search_path TO auth;

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           VARCHAR(20) NOT NULL CHECK (role IN ('super-admin','admin','agent','user')),
  first_name     VARCHAR(100) NOT NULL,
  last_name      VARCHAR(100) NOT NULL,
  phone          VARCHAR(20),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name     VARCHAR(255) NOT NULL,
  business_number   VARCHAR(50) UNIQUE NOT NULL,
  commission_rate   DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  approval_status   VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (approval_status IN ('PENDING','APPROVED','REJECTED')),
  approved_by       UUID REFERENCES auth.users(id),
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_shipping_policies (
  agent_id                UUID UNIQUE NOT NULL REFERENCES auth.agent_profiles(id) ON DELETE CASCADE,
  base_shipping_fee       INTEGER NOT NULL DEFAULT 3000,
  free_shipping_threshold INTEGER,
  remote_area_fee         INTEGER NOT NULL DEFAULT 3000,
  supported_couriers      TEXT[] NOT NULL DEFAULT '{}',
  default_courier         VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON auth.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON auth.refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_users_email ON auth.users(email);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_status ON auth.agent_profiles(approval_status);
