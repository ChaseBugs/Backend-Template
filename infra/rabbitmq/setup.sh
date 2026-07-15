#!/usr/bin/env bash
set -euo pipefail

RABBITMQ_URL="${RABBITMQ_URL:-amqp://guest:guest@localhost:5672}"
MGMT_URL="${RABBITMQ_MGMT_URL:-http://localhost:15672}"
MGMT_USER="${RABBITMQ_USER:-guest}"
MGMT_PASS="${RABBITMQ_PASS:-guest}"

declare() {
  local method=$1; local path=$2; local body=$3
  curl -sf -u "$MGMT_USER:$MGMT_PASS" \
    -X "$method" "${MGMT_URL}/api/${path}" \
    -H 'Content-Type: application/json' \
    -d "$body"
  echo "  [OK] $method $path"
}

echo "=== RabbitMQ setup ==="

# Notification topic exchange
declare PUT "exchanges/%2F/notifications" \
  '{"type":"topic","durable":true,"auto_delete":false}'

# Notification queues
declare PUT "queues/%2F/notification.email" \
  '{"durable":true,"arguments":{"x-dead-letter-exchange":"notifications.dlx"}}'
declare PUT "queues/%2F/notification.push" \
  '{"durable":true,"arguments":{"x-dead-letter-exchange":"notifications.dlx"}}'
declare PUT "queues/%2F/notification.sms" \
  '{"durable":true,"arguments":{"x-dead-letter-exchange":"notifications.dlx"}}'
# Remove the legacy in-app queue if an older release created it. In-app delivery
# is complete when the notification row is committed and is read over HTTP.
legacy_status=$(curl -sS -o /dev/null -w '%{http_code}' -u "$MGMT_USER:$MGMT_PASS" \
  -X DELETE "${MGMT_URL}/api/queues/%2F/notification.in_app")
if [[ "$legacy_status" != "204" && "$legacy_status" != "404" ]]; then
  echo "Failed to remove legacy notification.in_app queue (HTTP ${legacy_status})" >&2
  exit 1
fi
# In-app delivery is the authoritative notifications row written before publish;
# it does not need a broker queue. Broker queues are reserved for external channels.
for queue in notification.email notification.push notification.sms; do
  for routing_key in "order.*" "delivery.*" "payment.*" "agent.*" "inventory.*" "system.*"; do
    declare POST "bindings/%2F/e/notifications/q/${queue}" \
      "{\"routing_key\":\"${routing_key}\"}"
  done
done

# Dead-letter exchange
declare PUT "exchanges/%2F/notifications.dlx" \
  '{"type":"fanout","durable":true}'
declare PUT "queues/%2F/notifications.dlq" \
  '{"durable":true}'
declare POST "bindings/%2F/e/notifications.dlx/q/notifications.dlq" '{}'

echo "=== RabbitMQ setup complete ==="
