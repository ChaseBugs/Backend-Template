SET search_path TO product;

CREATE TABLE IF NOT EXISTS catalog_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   UUID REFERENCES product.categories(id),
  canonical_name VARCHAR(255) NOT NULL,
  brand         VARCHAR(100),
  manufacturer  VARCHAR(150),
  model_number  VARCHAR(100),
  gtin          VARCHAR(14),
  description   TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                CHECK (status IN ('ACTIVE','MERGED','INACTIVE')),
  merged_into_id UUID REFERENCES product.catalog_products(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (gtin IS NULL OR gtin ~ '^[0-9]{8,14}$'),
  CHECK ((status = 'MERGED') = (merged_into_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_products_gtin
  ON product.catalog_products(gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_products_model
  ON product.catalog_products(brand, model_number);

CREATE TABLE IF NOT EXISTS catalog_variants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id UUID NOT NULL REFERENCES product.catalog_products(id),
  variant_key        VARCHAR(64) NOT NULL,
  variant_name       VARCHAR(255),
  attributes         JSONB NOT NULL DEFAULT '{}',
  gtin               VARCHAR(14),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (gtin IS NULL OR gtin ~ '^[0-9]{8,14}$'),
  UNIQUE (catalog_product_id, variant_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_variants_gtin
  ON product.catalog_variants(gtin) WHERE gtin IS NOT NULL;

ALTER TABLE product.products
  ADD COLUMN IF NOT EXISTS catalog_variant_id UUID REFERENCES product.catalog_variants(id),
  ADD COLUMN IF NOT EXISTS condition VARCHAR(20) NOT NULL DEFAULT 'NEW'
    CHECK (condition IN ('NEW','OPEN_BOX','REFURBISHED','USED_LIKE_NEW','USED_GOOD','USED_ACCEPTABLE'));

-- Existing rows become independent catalog entries. Operators can merge them
-- later after GTIN/brand/model reconciliation without changing offer IDs.
INSERT INTO product.catalog_products (id, category_id, canonical_name, brand, description)
SELECT p.id, p.category_id, p.name, p.brand, p.description
FROM product.products p
WHERE p.catalog_variant_id IS NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO product.catalog_variants (id, catalog_product_id, variant_key, variant_name, attributes)
SELECT p.id, p.id, md5('{}'), p.name, '{}'
FROM product.products p
WHERE p.catalog_variant_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE product.products SET catalog_variant_id = id WHERE catalog_variant_id IS NULL;
ALTER TABLE product.products ALTER COLUMN catalog_variant_id SET NOT NULL;

-- SKU belongs to a seller offer, not to the global catalog.
ALTER TABLE product.products DROP CONSTRAINT IF EXISTS products_sku_key;
DROP INDEX IF EXISTS product.idx_products_sku;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_agent_sku
  ON product.products(agent_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_catalog_variant
  ON product.products(catalog_variant_id);

-- One seller may publish one active offer for a variant/condition. Historical
-- inactive offers remain available for order snapshots and audits.
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_active_offer
  ON product.products(agent_id, catalog_variant_id, condition)
  WHERE status <> 'INACTIVE' AND is_deleted = FALSE;

GRANT SELECT, INSERT, UPDATE ON product.catalog_products, product.catalog_variants TO product_svc;
GRANT SELECT ON product.catalog_products, product.catalog_variants TO admin_svc, sync_worker;
