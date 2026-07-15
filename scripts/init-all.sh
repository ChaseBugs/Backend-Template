#!/usr/bin/env bash
# Full infrastructure initialisation — run ONCE on a fresh server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

###############################################################################
# Config (override via env or edit here)
###############################################################################
PG_SUPERUSER="${PG_SUPERUSER:-postgres}"
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PGPASSWORD="${PGPASSWORD:-}"
ENV_FILE="${ENV_FILE:-/etc/ecommerce/backend.env}"
export PGPASSWORD

KAFKA_HOME="${KAFKA_HOME:-/opt/kafka}"
OPENSEARCH_URL="${OPENSEARCH_URL:-http://localhost:9200}"
RABBITMQ_MGMT_URL="${RABBITMQ_MGMT_URL:-http://localhost:15672}"
RABBITMQ_USER="${RABBITMQ_USER:-guest}"
RABBITMQ_PASS="${RABBITMQ_PASS:-guest}"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
step() { echo; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; log "STEP: $*"; echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"; }

###############################################################################
# 1. PostgreSQL
###############################################################################
step "PostgreSQL — create schemas and service users"

run_sql() {
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPERUSER" -d ecommerce "$@"
}

psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPERUSER" -c "CREATE DATABASE ecommerce;" 2>/dev/null \
  || log "Database 'ecommerce' already exists, continuing."

for f in "$ROOT_DIR"/infra/postgres/*.sql; do
  log "Running $f"
  run_sql -f "$f"
done

# Production service credentials are deliberately not embedded in migrations.
# Rotate every dedicated role to the password from the installed environment
# after the roles and schemas exist. Local development without ENV_FILE keeps
# the documented development credentials.
if [[ -f "$ENV_FILE" ]]; then
  env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
  role_names=(auth_svc product_svc order_svc payment_svc inventory_svc admin_svc notification_svc delivery_svc review_svc)
  url_variables=(AUTH_DATABASE_URL PRODUCT_DATABASE_URL ORDER_DATABASE_URL PAYMENT_DATABASE_URL INVENTORY_DATABASE_URL ADMIN_DATABASE_URL NOTIFICATION_DATABASE_URL DELIVERY_DATABASE_URL REVIEW_DATABASE_URL)
  for index in "${!role_names[@]}"; do
    role="${role_names[$index]}"
    variable="${url_variables[$index]}"
    database_url="$(env_value "$variable")"
    [[ -n "$database_url" ]] || { echo "ERROR: $ENV_FILE is missing $variable" >&2; exit 1; }
    database_user="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).username))' "$database_url")"
    database_password="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).password))' "$database_url")"
    [[ "$database_user" == "$role" ]] || { echo "ERROR: $variable must use PostgreSQL role $role" >&2; exit 1; }
    [[ -n "$database_password" ]] || { echo "ERROR: $variable has no password" >&2; exit 1; }
    printf "ALTER ROLE %s WITH PASSWORD :'role_password';\n" "$role" | run_sql -v role_password="$database_password"
  done
  log "Dedicated PostgreSQL service passwords rotated from $ENV_FILE."
else
  log "Environment file $ENV_FILE not found; retaining development database passwords."
fi

log "PostgreSQL init complete."

###############################################################################
# 2. Kafka topics
###############################################################################
step "Kafka — creating topics"
KAFKA_HOME="$KAFKA_HOME" bash "$ROOT_DIR/infra/kafka/topics.sh"

###############################################################################
# 3. RabbitMQ exchanges/queues
###############################################################################
step "RabbitMQ — creating exchanges and queues"
RABBITMQ_MGMT_URL="$RABBITMQ_MGMT_URL" \
RABBITMQ_USER="$RABBITMQ_USER" \
RABBITMQ_PASS="$RABBITMQ_PASS" \
bash "$ROOT_DIR/infra/rabbitmq/setup.sh"

###############################################################################
# 4. OpenSearch indices
###############################################################################
step "OpenSearch — creating indices"
OPENSEARCH_URL="$OPENSEARCH_URL" bash "$ROOT_DIR/infra/opensearch/setup.sh"

###############################################################################
# 5. Log directories
###############################################################################
step "Log directories"
for svc in api-gateway auth-service product-service order-service payment-service \
           cart-service search-service inventory-service admin-service \
           notification-service delivery-service review-service sync-worker; do
  mkdir -p "$ROOT_DIR/logs/$svc"
done
log "Log directories ready."

###############################################################################
# 6. Build all services
###############################################################################
step "Building all services (pnpm turbo build)"
cd "$ROOT_DIR"
pnpm turbo build

###############################################################################
# 7. Seed super-admin
###############################################################################
step "Seeding super-admin account"
bash "$SCRIPT_DIR/seed-super-admin.sh"

log ""
log "=============================="
log "  Initialization COMPLETE"
log "=============================="
log "Start with: pm2 start ecosystem.config.js"
