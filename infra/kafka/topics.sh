#!/usr/bin/env bash
set -euo pipefail

KAFKA_HOME="${KAFKA_HOME:-/opt/kafka}"
BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
PARTITIONS="${KAFKA_PARTITIONS:-6}"
REPLICATION="${KAFKA_REPLICATION:-1}"      # set to 3 for multi-broker prod

$KAFKA_HOME/bin/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" \
  --command-config "$KAFKA_HOME/config/admin-client.properties" 2>/dev/null || true

create_topic() {
  local topic=$1
  local partitions=${2:-$PARTITIONS}
  local retention_ms=${3:-604800000}  # 7 days default

  $KAFKA_HOME/bin/kafka-topics.sh \
    --bootstrap-server "$BOOTSTRAP" \
    --create --if-not-exists \
    --topic "$topic" \
    --partitions "$partitions" \
    --replication-factor "$REPLICATION" \
    --config retention.ms="$retention_ms" \
    --config cleanup.policy=delete
  echo "  [OK] $topic"
}

echo "=== Creating Kafka topics ==="

# Domain event topics (7 days retention).
# One topic per event type (matches packages/shared/src/events/kafka-events.ts
# KafkaTopic values exactly — producers/consumers use these literal names and
# allowAutoTopicCreation is disabled, so this list must stay in sync with that file).

# Auth events
create_topic "user.registered"
create_topic "user.role.changed"
create_topic "user.status.changed"
create_topic "agent.application.submitted"
create_topic "agent.approved"
create_topic "agent.rejected"

# Product events
create_topic "product.created"
create_topic "product.updated"
create_topic "product.deleted"
create_topic "product.approved"
create_topic "product.rejected"

# Inventory events
create_topic "inventory.reserved"
create_topic "inventory.reservation.failed"
create_topic "inventory.released"
create_topic "inventory.deducted"
create_topic "inventory.updated"
create_topic "stock.low"
create_topic "review.rating.updated"

# Operations events
create_topic "system.warning"

# Order events
create_topic "order.created"
create_topic "order.confirmed"
create_topic "order.paid"
create_topic "order.cancelled"
create_topic "order.completed"
create_topic "order.status.changed"

# Payment events
create_topic "payment.completed"
create_topic "payment.failed"
create_topic "payment.refunded"
create_topic "payment.agent-settlement.created"
create_topic "payment.agent-settlement.completed"

# Delivery events
create_topic "delivery.group.created"
create_topic "delivery.delayed"
create_topic "delivery.shipped"
create_topic "delivery.delivered"
create_topic "delivery.all.completed"
create_topic "delivery.return.requested"
create_topic "delivery.return.completed"

# Dead letter queues (30 days retention) — one per domain.
create_topic "order.events.dlq"       2 2592000000
create_topic "inventory.events.dlq"   2 2592000000
create_topic "payment.events.dlq"     2 2592000000
create_topic "product.events.dlq"     2 2592000000
create_topic "delivery.events.dlq"    2 2592000000
create_topic "notification.events.dlq" 2 2592000000
create_topic "sync.events.dlq"         2 2592000000
create_topic "review.events.dlq"       2 2592000000
create_topic "cart.events.dlq"         2 2592000000

echo "=== All topics created ==="
$KAFKA_HOME/bin/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --list
