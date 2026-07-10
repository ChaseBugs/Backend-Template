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
           notification-service delivery-service sync-worker; do
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
