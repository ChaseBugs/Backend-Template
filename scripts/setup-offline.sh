#!/usr/bin/env bash
# Install the backend from a pre-staged, fully offline release directory.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/ecommerce/backend}"
SERVICE_USER="${SERVICE_USER:-ecommerce}"
PNPM_STORE_DIR="${PNPM_STORE_DIR:-$ROOT_DIR/offline/pnpm-store}"
ENV_SOURCE="${ENV_SOURCE:-$ROOT_DIR/offline/env.production}"
CHECK_ONLY=false
SKIP_BUILD=false

usage() {
  cat <<EOF
Usage: sudo bash scripts/setup-offline.sh [--check] [--skip-build]

Environment overrides:
  INSTALL_DIR       Target directory (default: /opt/ecommerce/backend)
  SERVICE_USER      Non-login runtime user (default: ecommerce)
  PNPM_STORE_DIR    Pre-fetched pnpm store
  ENV_SOURCE        Production environment file containing real secrets

This script never downloads packages and never uses Docker/Kubernetes.
EOF
}

while (($#)); do
  case "$1" in
    --check) CHECK_ONLY=true ;;
    --skip-build) SKIP_BUILD=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

fail() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "Required command not installed: $1"; }
version_major() { "$1" --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }

[[ "$(uname -s)" == Linux ]] || fail "Offline deployment supports Linux only"
for command in bash node corepack psql redis-cli curl nginx logrotate systemctl tar sha256sum; do need "$command"; done
[[ "$(version_major node)" -ge 20 ]] || fail "Node.js 20 or newer is required"
[[ -f "$ROOT_DIR/pnpm-lock.yaml" ]] || fail "Run from a complete release tree"
[[ -d "$PNPM_STORE_DIR" ]] || fail "Offline pnpm store not found: $PNPM_STORE_DIR"
[[ -f "$ENV_SOURCE" ]] || fail "Production environment file not found: $ENV_SOURCE"
[[ -x /opt/jaeger/jaeger ]] || fail "Jaeger v2 binary not found or executable: /opt/jaeger/jaeger"
if [[ -f "$ROOT_DIR/RELEASE_MANIFEST.sha256" ]]; then
  (cd "$ROOT_DIR" && sha256sum --check --strict RELEASE_MANIFEST.sha256) \
    || fail "Release manifest verification failed"
fi
if grep -Eq '^DATABASE_URL=' "$ENV_SOURCE"; then
  fail "$ENV_SOURCE must use service-specific database URLs, not a shared DATABASE_URL"
fi

database_env=(AUTH_DATABASE_URL PRODUCT_DATABASE_URL ORDER_DATABASE_URL PAYMENT_DATABASE_URL \
  INVENTORY_DATABASE_URL ADMIN_DATABASE_URL NOTIFICATION_DATABASE_URL DELIVERY_DATABASE_URL \
  REVIEW_DATABASE_URL)
required_env=(JWT_SECRET INTERNAL_SERVICE_TOKEN ALLOWED_ORIGINS KAFKA_BROKERS REDIS_HOST \
  MONGODB_URI OPENSEARCH_URL RABBITMQ_URL "${database_env[@]}")
for variable in "${required_env[@]}"; do
  grep -Eq "^${variable}=.+" "$ENV_SOURCE" || fail "$ENV_SOURCE is missing $variable"
done
if grep -Eq '=(CHANGE.*|change-me|test-key|dev-internal-token|secret|change_this.*)$' "$ENV_SOURCE"; then
  fail "$ENV_SOURCE contains a known development/default secret"
fi

env_value() { sed -n "s/^$1=//p" "$ENV_SOURCE" | tail -1; }
jwt_secret="$(env_value JWT_SECRET)"
internal_service_token="$(env_value INTERNAL_SERVICE_TOKEN)"
[[ "${#jwt_secret}" -ge 64 ]] || fail "JWT_SECRET must contain at least 64 characters"
[[ "${#internal_service_token}" -ge 32 ]] || fail "INTERNAL_SERVICE_TOKEN must contain at least 32 characters"

declare -A database_urls
database_roles=(auth_svc product_svc order_svc payment_svc inventory_svc admin_svc notification_svc delivery_svc review_svc)
for index in "${!database_env[@]}"; do
  variable="${database_env[$index]}"
  expected_role="${database_roles[$index]}"
  value="$(env_value "$variable")"
  [[ "$value" =~ ^postgres(ql)?:// ]] || fail "$variable must be a PostgreSQL URL"
  [[ "$value" != *'_pass@'* ]] || fail "$variable contains a known development database password"
  actual_role="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.argv[1]).username))' "$value")" || fail "$variable is not a valid URL"
  [[ "$actual_role" == "$expected_role" ]] || fail "$variable must use the dedicated PostgreSQL role $expected_role"
  [[ -z "${database_urls[$value]:-}" ]] || fail "$variable duplicates the database credentials used by ${database_urls[$value]}"
  database_urls[$value]="$variable"
done
[[ "$(env_value ALLOWED_ORIGINS)" != '*' ]] || fail "ALLOWED_ORIGINS must not allow every origin in production"
[[ "$(env_value RABBITMQ_URL)" != *'guest:guest@'* ]] || fail "RABBITMQ_URL must not use guest credentials"

if $CHECK_ONLY; then
  echo "Offline prerequisites are present. No changes made."
  exit 0
fi
[[ "$EUID" -eq 0 ]] || fail "Run installation as root"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir /opt/ecommerce --shell /usr/sbin/nologin "$SERVICE_USER"
fi
if ! id jaeger >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/jaeger --shell /usr/sbin/nologin jaeger
fi
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0750 "$INSTALL_DIR" "$INSTALL_DIR/logs"

# Copy the staged release without deleting files that may contain operator data.
tar --exclude='.git' --exclude='node_modules' --exclude='logs' --exclude='offline' -C "$ROOT_DIR" -cf - . \
  | tar -C "$INSTALL_DIR" -xf -
install -d -o root -g "$SERVICE_USER" -m 0750 /etc/ecommerce
install -o root -g "$SERVICE_USER" -m 0640 "$ENV_SOURCE" /etc/ecommerce/backend.env
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

cd "$INSTALL_DIR"
corepack enable
runuser -u "$SERVICE_USER" -- env PNPM_HOME="${PNPM_HOME:-/usr/local/bin}" \
  pnpm install --offline --frozen-lockfile --store-dir "$PNPM_STORE_DIR"
if ! $SKIP_BUILD; then
  runuser -u "$SERVICE_USER" -- pnpm -r --if-present build
fi

bash scripts/install-systemd.sh
install -D -m 0644 infra/nginx/nginx.conf /etc/nginx/nginx.conf
install -D -m 0644 infra/logrotate/ecommerce-backend /etc/logrotate.d/ecommerce-backend
install -D -o root -g jaeger -m 0640 infra/jaeger/config.yml /etc/jaeger/config.yml
install -D -m 0644 infra/systemd/jaeger.service /etc/systemd/system/jaeger.service
nginx -t
logrotate --debug /etc/logrotate.d/ecommerce-backend >/dev/null
systemctl daemon-reload
systemctl enable jaeger.service

echo "Application installed at $INSTALL_DIR."
echo "Next: start PostgreSQL, Redis, Kafka, RabbitMQ, MongoDB and OpenSearch; then run scripts/init-all.sh."
echo "Finally: systemctl start jaeger ecommerce-backend nginx"
