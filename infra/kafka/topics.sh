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

# Domain event topics (7 days retention)
create_topic "order.events"
create_topic "inventory.events"
create_topic "payment.events"
create_topic "product.events"
create_topic "user.events"
create_topic "agent.events"
create_topic "delivery.events"

# Dead letter queues (30 days retention)
create_topic "order.events.dlq"       2 2592000000
create_topic "inventory.events.dlq"   2 2592000000
create_topic "payment.events.dlq"     2 2592000000
create_topic "product.events.dlq"     2 2592000000
create_topic "delivery.events.dlq"    2 2592000000

echo "=== All topics created ==="
$KAFKA_HOME/bin/kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --list
