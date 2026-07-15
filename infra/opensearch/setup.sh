#!/usr/bin/env bash
set -euo pipefail

OS_URL="${OPENSEARCH_URL:-http://localhost:9200}"

echo "=== OpenSearch index setup ==="

create_index() {
  local index=$1
  local mapping_file=$2

  # check if exists
  if curl -sf -o /dev/null "${OS_URL}/${index}"; then
    # Mapping additions are safe on an existing index and keep reruns useful.
    node -e "const value=require(process.argv[1]); process.stdout.write(JSON.stringify(value.mappings))" "$mapping_file" \
      | curl -sf -X PUT "${OS_URL}/${index}/_mapping" -H 'Content-Type: application/json' -d @-
    echo "  [OK] updated mapping for existing index '${index}'"
    return
  fi

  curl -sf -X PUT "${OS_URL}/${index}" \
    -H 'Content-Type: application/json' \
    -d @"$mapping_file"
  echo "  [OK] created index '${index}'"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

create_index "products" "${SCRIPT_DIR}/products-index.json"
create_index "users" "${SCRIPT_DIR}/users-index.json"
create_index "agents" "${SCRIPT_DIR}/agents-index.json"

echo "=== OpenSearch setup complete ==="
