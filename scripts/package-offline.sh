#!/usr/bin/env bash
# Build a self-contained release archive on a connected, trusted build machine.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-$(date -u +%Y%m%dT%H%M%SZ)}"
OUTPUT_DIR="${OUTPUT_DIR:-$(dirname "$ROOT_DIR")/releases}"
STORE_DIR="${STORE_DIR:-$ROOT_DIR/offline/pnpm-store}"
ARCHIVE="$OUTPUT_DIR/ecommerce-backend-$VERSION.tar.gz"
STAGE="$(mktemp -d)"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

command -v node >/dev/null || { echo 'node is required' >&2; exit 1; }
command -v corepack >/dev/null || { echo 'corepack is required' >&2; exit 1; }
command -v tar >/dev/null || { echo 'tar is required' >&2; exit 1; }
command -v sha256sum >/dev/null || { echo 'sha256sum is required' >&2; exit 1; }
[[ -f "$ROOT_DIR/pnpm-lock.yaml" ]] || { echo 'pnpm-lock.yaml is missing' >&2; exit 1; }

mkdir -p "$OUTPUT_DIR" "$STORE_DIR" "$STAGE/release"
corepack enable
cd "$ROOT_DIR"
pnpm fetch --frozen-lockfile --store-dir "$STORE_DIR"

# Do not package operator secrets, VCS metadata, generated output, or runtime logs.
tar --exclude='.git' --exclude='node_modules' --exclude='**/dist' --exclude='.turbo' \
  --exclude='logs' --exclude='offline/env.production' --exclude='offline/pnpm-store' \
  -cf - . | tar -C "$STAGE/release" -xf -
mkdir -p "$STAGE/release/offline"
cp -a "$STORE_DIR" "$STAGE/release/offline/pnpm-store"

cd "$STAGE/release"
find . -type f ! -name RELEASE_MANIFEST.sha256 -print0 \
  | sort -z | xargs -0 sha256sum > RELEASE_MANIFEST.sha256
tar -czf "$ARCHIVE" .
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"

echo "Created $ARCHIVE"
echo "Created $ARCHIVE.sha256"
