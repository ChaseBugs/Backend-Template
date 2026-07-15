# Live infrastructure integration tests

These tests target the native on-prem services and intentionally do not use mocks,
Docker, or test containers. Initialize the infrastructure with `scripts/init-all.sh`,
then run:

```bash
pnpm test:integration
```

Optional connection overrides:

- `INTEGRATION_DATABASE_URL`
- `INTEGRATION_REDIS_HOST`, `INTEGRATION_REDIS_PORT`, `INTEGRATION_REDIS_PASSWORD`, `INTEGRATION_REDIS_DB`
- `INTEGRATION_KAFKA_BROKERS`, `INTEGRATION_KAFKA_TOPIC`
- `INTEGRATION_RABBITMQ_URL`
- `INTEGRATION_OPENSEARCH_URL`, `INTEGRATION_OPENSEARCH_PRODUCTS_INDEX`

The database test rolls back all inserted rows. The Redis test uses database 15 by
default and removes its lock key. The Kafka test uses a unique consumer group and a
unique marker on the pre-created `order.events.dlq` topic. The RabbitMQ test creates
an exclusive queue and auto-delete exchange, verifies publisher confirmation and
delivery, then removes both. The OpenSearch test verifies the committed product
mapping and Korean analyzer, indexes a uniquely identified document, searches it,
and deletes it in `finally`.

## Full commerce E2E

With every application and native dependency running, execute the complete
agent-to-settlement workflow through the API Gateway:

```bash
E2E_ADMIN_EMAIL=superadmin@example.com \
E2E_ADMIN_PASSWORD='replace-me' \
pnpm test:e2e
```

The scenario registers unique agent and buyer accounts, approves the agent,
configures shipping, creates and moderates a product, stocks it, converts a
cart into an order, pays, ships, confirms receipt, completes settlement, then
requests a return and verifies its refund/settlement adjustment. It polls
eventually-consistent Kafka projections rather than relying on fixed sleeps.

Configuration:

- `E2E_BASE_URL` (default `http://localhost:3000/api/v1`)
- `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD` (required)
- `E2E_CATEGORY_ID` (optional; otherwise the first category is read from PostgreSQL)
- `INTEGRATION_DATABASE_URL` (default local `postgres/postgres` connection)
- `E2E_TIMEOUT_MS` and `E2E_POLL_INTERVAL_MS`

The run is intentionally retained as auditable test data because deleting rows
immediately would race asynchronous consumers and invalidate recovery evidence.
Every run uses a unique suffix and idempotency keys, so it is safe to rerun.
