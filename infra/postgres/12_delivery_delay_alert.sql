SET search_path TO delivery;

ALTER TABLE delivery_groups
  ADD COLUMN IF NOT EXISTS delay_alerted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_delivery_groups_unalerted_delay
  ON delivery.delivery_groups(created_at)
  WHERE status = 'PREPARING' AND delay_alerted_at IS NULL;
