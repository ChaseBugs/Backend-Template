#!/usr/bin/env bash
# Seeds the initial super-admin account directly into PostgreSQL.
# Runs only if no super-admin exists yet.
set -euo pipefail

PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
PGPASSWORD="${PGPASSWORD:-}"
export PGPASSWORD

# Default seed values — CHANGE BEFORE GOING LIVE
SA_EMAIL="${SUPER_ADMIN_EMAIL:-superadmin@ecommerce.local}"
SA_PASS="${SUPER_ADMIN_PASSWORD:-ChangeMe!2025}"
SA_FIRST="${SUPER_ADMIN_FIRST:-Super}"
SA_LAST="${SUPER_ADMIN_LAST:-Admin}"
SA_PHONE="${SUPER_ADMIN_PHONE:-010-0000-0000}"

# Require bcrypt; use Node to hash if available
if ! command -v node &>/dev/null; then
  echo "ERROR: node not found. Cannot hash password." >&2
  exit 1
fi

HASH=$(node -e "
const bcrypt = require('bcrypt');
bcrypt.hash('${SA_PASS}', 12).then(h => process.stdout.write(h));
")

EXISTS=$(psql -h "$PG_HOST" -p "$PG_PORT" -U auth_svc -d ecommerce -t -c \
  "SELECT COUNT(*) FROM auth.users WHERE role='super-admin';" 2>/dev/null | tr -d ' ')

if [[ "$EXISTS" -gt 0 ]]; then
  echo "[SKIP] super-admin already exists."
  exit 0
fi

psql -h "$PG_HOST" -p "$PG_PORT" -U auth_svc -d ecommerce <<SQL
INSERT INTO auth.users (email, password_hash, role, first_name, last_name, phone)
VALUES (
  '${SA_EMAIL}',
  '${HASH}',
  'super-admin',
  '${SA_FIRST}',
  '${SA_LAST}',
  '${SA_PHONE}'
);
SQL

echo "[OK] super-admin seeded: ${SA_EMAIL}"
echo "     Change password immediately after first login!"
