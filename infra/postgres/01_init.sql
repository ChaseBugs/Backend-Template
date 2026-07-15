-- ============================================================
-- 1. Schemas
-- ============================================================
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS product;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS "order";
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS delivery;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS admin;
CREATE SCHEMA IF NOT EXISTS review;

-- ============================================================
-- 2. Dedicated service users
-- ============================================================
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_svc') THEN CREATE USER auth_svc WITH PASSWORD 'auth_pass' CONNECTION LIMIT 30; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_svc') THEN CREATE USER product_svc WITH PASSWORD 'product_pass' CONNECTION LIMIT 30; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'inventory_svc') THEN CREATE USER inventory_svc WITH PASSWORD 'inventory_pass' CONNECTION LIMIT 30; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'order_svc') THEN CREATE USER order_svc WITH PASSWORD 'order_pass' CONNECTION LIMIT 30; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_svc') THEN CREATE USER payment_svc WITH PASSWORD 'payment_pass' CONNECTION LIMIT 30; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'delivery_svc') THEN CREATE USER delivery_svc WITH PASSWORD 'delivery_pass' CONNECTION LIMIT 30; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notification_svc') THEN CREATE USER notification_svc WITH PASSWORD 'notification_pass' CONNECTION LIMIT 10; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_svc') THEN CREATE USER admin_svc WITH PASSWORD 'admin_pass' CONNECTION LIMIT 10; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sync_worker') THEN CREATE USER sync_worker WITH PASSWORD 'sync_pass' CONNECTION LIMIT 10; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'review_svc') THEN CREATE USER review_svc WITH PASSWORD 'review_pass' CONNECTION LIMIT 20; END IF; END $$;

-- ============================================================
-- 3. Schema-level grants
-- ============================================================
-- auth_svc owns auth schema
GRANT USAGE, CREATE ON SCHEMA auth TO auth_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO auth_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO auth_svc;

-- product_svc owns product schema
GRANT USAGE, CREATE ON SCHEMA product TO product_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA product TO product_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA product GRANT ALL ON TABLES TO product_svc;

-- inventory_svc owns inventory schema
GRANT USAGE, CREATE ON SCHEMA inventory TO inventory_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA inventory TO inventory_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA inventory GRANT ALL ON TABLES TO inventory_svc;

-- order_svc owns order schema
GRANT USAGE, CREATE ON SCHEMA "order" TO order_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA "order" TO order_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA "order" GRANT ALL ON TABLES TO order_svc;

-- payment_svc owns payment schema
GRANT USAGE, CREATE ON SCHEMA payment TO payment_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA payment TO payment_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA payment GRANT ALL ON TABLES TO payment_svc;

-- delivery_svc owns delivery schema
GRANT USAGE, CREATE ON SCHEMA delivery TO delivery_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA delivery TO delivery_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA delivery GRANT ALL ON TABLES TO delivery_svc;

-- notification_svc owns notification schema
GRANT USAGE, CREATE ON SCHEMA notification TO notification_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA notification TO notification_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification GRANT ALL ON TABLES TO notification_svc;

-- review_svc owns review schema
GRANT USAGE, CREATE ON SCHEMA review TO review_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA review TO review_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA review GRANT ALL ON TABLES TO review_svc;

-- admin_svc has SELECT across all schemas
GRANT USAGE ON SCHEMA auth, product, inventory, "order", payment, delivery, notification, review, admin TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA product TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA inventory TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA "order" TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA payment TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA delivery TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA notification TO admin_svc;
GRANT SELECT ON ALL TABLES IN SCHEMA review TO admin_svc;
GRANT USAGE, CREATE ON SCHEMA admin TO admin_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA admin TO admin_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT ALL ON TABLES TO admin_svc;

-- sync_worker has SELECT across all schemas
GRANT USAGE ON SCHEMA auth, product, inventory, "order", payment, delivery, notification, review, admin TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA auth TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA product TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA inventory TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA "order" TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA payment TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA delivery TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA notification TO sync_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA review TO sync_worker;
