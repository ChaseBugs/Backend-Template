SET search_path TO review;

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  product_id UUID NOT NULL,
  user_id UUID NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title VARCHAR(120) NOT NULL CHECK (length(trim(title)) > 0),
  comment VARCHAR(5000) NOT NULL CHECK (length(trim(comment)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_reviews_user_product UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_product_created
  ON reviews(product_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS review_rating_outbox (
  product_id UUID PRIMARY KEY,
  event_id UUID NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_rating_outbox_requested
  ON review_rating_outbox(requested_at);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA review TO review_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA review TO admin_svc, sync_worker;
