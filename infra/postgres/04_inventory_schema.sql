SET search_path TO inventory;

CREATE TABLE IF NOT EXISTS inventories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID UNIQUE NOT NULL,            -- ref: product.products.id
  variant_id          UUID,                            -- ref: product.product_variants.id (nullable for base product)
  agent_id            UUID NOT NULL,                   -- ref: auth.agent_profiles.id
  quantity_available  INTEGER NOT NULL DEFAULT 0 CHECK (quantity_available >= 0),
  quantity_reserved   INTEGER NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL,                          -- ref: product.products.id
  reference_id UUID,                                   -- order/saga reference
  type         VARCHAR(20) NOT NULL
               CHECK (type IN ('IN','OUT','RESERVE','RELEASE','ADJUST')),
  quantity     INTEGER NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventories_product  ON inventory.inventories(product_id);
CREATE INDEX IF NOT EXISTS idx_inventories_agent    ON inventory.inventories(agent_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON inventory.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_ref     ON inventory.stock_movements(reference_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movement_event
  ON inventory.stock_movements(product_id, type, reference_id)
  WHERE reference_id IS NOT NULL;
