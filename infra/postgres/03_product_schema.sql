SET search_path TO product;

CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(100) UNIQUE NOT NULL,
  parent_id   UUID REFERENCES product.categories(id),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL,                   -- ref: auth.agent_profiles.id
  category_id       UUID REFERENCES product.categories(id),
  name              VARCHAR(255) NOT NULL,
  slug              VARCHAR(255) UNIQUE,
  description       TEXT,
  price             INTEGER NOT NULL,                -- KRW, stored in won
  compare_price     INTEGER,
  sku               VARCHAR(100) UNIQUE,
  brand             VARCHAR(100),
  tags              TEXT[] NOT NULL DEFAULT '{}',
  images            TEXT[] NOT NULL DEFAULT '{}',
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
                    CHECK (status IN ('PENDING_APPROVAL','ACTIVE','INACTIVE','REJECTED')),
  rejection_reason  TEXT,
  approved_by       UUID,                            -- ref: auth.users.id
  approved_at       TIMESTAMPTZ,
  weight_g          INTEGER,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  view_count        INTEGER NOT NULL DEFAULT 0,
  idempotency_key   VARCHAR(255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep initialization safe for installations created before idempotent product creation.
ALTER TABLE product.products
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);

CREATE TABLE IF NOT EXISTS product_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES product.products(id) ON DELETE CASCADE,
  url         VARCHAR(500) NOT NULL,
  alt_text    VARCHAR(255),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS product_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES product.products(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  values      TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS product_variants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES product.products(id) ON DELETE CASCADE,
  sku           VARCHAR(100) UNIQUE NOT NULL,
  option_values JSONB NOT NULL DEFAULT '{}',
  price         INTEGER,
  weight_g      INTEGER,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_products_agent     ON product.products(agent_id);
CREATE INDEX IF NOT EXISTS idx_products_category  ON product.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status    ON product.products(status);
CREATE INDEX IF NOT EXISTS idx_products_sku       ON product.products(sku);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_agent_idempotency
  ON product.products(agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_images_pid ON product.product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_product   ON product.product_variants(product_id);
