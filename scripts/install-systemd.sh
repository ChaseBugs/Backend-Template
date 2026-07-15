#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SOURCE="$ROOT_DIR/infra/systemd/ecommerce-backend.service"
UNIT_TARGET="/etc/systemd/system/ecommerce-backend.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

install -D -m 0644 "$UNIT_SOURCE" "$UNIT_TARGET"
install -d -o ecommerce -g ecommerce -m 0750 /opt/ecommerce/backend/logs
systemctl daemon-reload
systemctl enable ecommerce-backend.service
echo "Installed $UNIT_TARGET. Start it with: systemctl start ecommerce-backend"
