# Implementation audit

This document records implementation evidence against `todo-list.md`. A checked
source file or a passing unit test is not treated as proof that external
infrastructure is running. The original checklist remains unchanged until each
item can be verified at its required scope.

## Status meanings

- **Implemented**: source, contract, and automated local checks exist.
- **Partial**: useful implementation exists, but a named requirement or
  end-to-end proof is still missing.
- **External verification required**: configuration/harness exists, but the
  required daemon or multi-node environment was unavailable on this workstation.

## Phase audit

| Phase | Status | Current evidence | Remaining proof or work |
| --- | --- | --- | --- |
| 0 Architecture and contracts | Implemented | `docs/architecture.md`, `docs/openapi.json`, `scripts/openapi.mjs`; route drift check covers 74 gateway paths, every public mutation has an explicit request schema, bodyless operations and HTTP 201 creation responses are asserted, and agent-only registration requirements are conditional | Render/review diagrams as infrastructure topology changes |
| 1 Monorepo foundation | Implemented | pnpm workspace, Turborepo, TypeScript, environment examples, PM2 for 13 backend processes plus the admin dashboard, systemd, Nginx, offline setup script | None found in static audit |
| 2 Shared packages | Implemented | Complete typed event catalog, RBAC, Kafka/RabbitMQ/Redis/logger packages; JSON Schema validation; tested Kafka batch commit/retry/DLQ; RabbitMQ topology replay and confirm-before-ACK retry | Live broker compatibility and reconnect test |
| 3 Native infrastructure | External verification required | Ordered SQL, Kafka topics, RabbitMQ/OpenSearch initialization, Nginx and native setup assets pass `infra:check` | Install and exercise PostgreSQL, MongoDB, Redis cluster, Kafka, RabbitMQ and OpenSearch on the target Linux topology |
| 4 API gateway | Implemented | JWT/header sanitization, Redis rate limits, role guards, proxies, circuit breakers, observability and readiness; downstream readiness covers each service's required PostgreSQL/Redis/MongoDB/OpenSearch/Kafka/RabbitMQ connections and treats an explicit false connection state as down; gateway tests | Live proxy/circuit-breaker test with services running |
| 5 Authentication | Implemented | Registration, login/logout/refresh, role changes, agent approval, administrator-recipient resolution, ownership/RBAC routes; user activation/deactivation and commission changes execute in auth-owned transactions, revoke sessions, enforce privileged-target rules and synchronize active state to CQRS | Live PostgreSQL/Redis/Kafka flow |
| 6 Product catalog | Implemented | Marketplace hierarchy separates canonical catalog products, attribute-keyed variants and seller offers; GTIN matching reuses canonical records, seller SKU is unique per agent, multiple sellers retain independent prices/condition/inventory, legacy offer UUIDs remain stable, and public catalog/offer discovery routes are available; ownership, moderation lifecycle, idempotency, query routes, resolver and tests remain in place; verified-purchase reviews persist in the review-owned PostgreSQL schema and rating changes use an atomic outbox | Live read-model and rating synchronization |
| 7 Search | Implemented | OpenSearch query/filter/fuzzy/cursor logic, autocomplete, cache invalidation and tests | Live nori index and OpenSearch integration |
| 8 Inventory | Implemented | Exact reservation/release, cancellation tombstones, Redis atomic scripts, ownership routes, threshold-based idempotent low-stock events, cache validation and bounded outcome/cache metrics with race tests | Live Redis/PostgreSQL/Kafka concurrency test |
| 9 Orders | Implemented | Idempotent creation/cancellation, saga transitions, seller shipping groups, monotonic delivery/refund handling; optional coupon codes now use row-locked validity/global/per-user limits, exact KRW discount allocation, atomic redemption, and replay-safe usage accounting | Full live saga and coupon concurrency test |
| 10 Payments and settlement | Implemented | Gateway adapter, strict UUID/method/idempotency validation, bounded refund validation, unknown-outcome handling, refund state machine, settlement and clawback logic; seller gross, commission, and returns use coupon-adjusted item values; settlement/adjustment transitions and deterministic completion events are owned by payment-service | Real PG adapter certification and live saga test |
| 11 Delivery | Implemented | Per-agent groups, shipping policies, lifecycle/return events, ownership, per-agent new-group throughput metrics, configurable overdue-PREPARING scanner with retry-safe alert marking, and tests | Live multi-agent delivery flow |
| 13 Cart | Implemented | Redis Hash cart, agent metadata, product snapshot resolution, atomic Lua quantity increment, mutation TTL renewal, and idempotent `ORDER_CREATED` post-commit clearing with DLQ and tests | Live Redis/Kafka order conversion test |
| 14 Notifications | Implemented | Kafka/RabbitMQ routing; customer/seller messages; role-broadcast agent-application, delivery-delay and readiness-based system warnings for active admins; per-recipient idempotency; idempotent SMTP, push and SMS adapters with delivery audit/retry state; in-app delivery uses the authoritative PostgreSQL row without an unconsumed broker queue; history, retry/DLQ and tests | Live provider certification remains deployment verification rather than missing application logic |
| 15 Administration | Implemented | User/product/order/delivery/analytics/audit/settlement APIs and dashboard pages; mutations call auth/product/order/payment owning services and admin-service writes only its audit schema, matching its production grants; product force deletion and payment refund are RBAC-protected and audited; user/order filters are parameterized and server-side; dashboard pagination follows `{ data, meta }`; response-contract tests and production Next.js build pass; PM2 and same-origin Nginx routing deploy the UI on port 4001 | Full browser automation remains environment verification |
| 16 CQRS sync worker | Implemented | Product/user/order/delivery Mongo projections (including user active state and order discount totals/discounted lines), user/agent OpenSearch projections, ordered `bulkWrite`, bounded `p-limit`, post-write Redis invalidation, commit-after-projection Kafka batches, DLQ, readiness/metrics and tests | Live MongoDB/OpenSearch/Kafka replay and recovery test |
| 17 Observability | Partial | Per-service Prometheus/domain metrics and provisioned Grafana; OTel NodeSDK auto-instrumentation preloaded in all PM2 services with OTLP/HTTP, W3C context and active trace IDs in logs; native Jaeger v2 config/systemd unit; readiness warnings cover the gateway and every managed service except the monitoring admin-service itself; isolated admin audit JSON and logrotate | Live Prometheus/Grafana/Jaeger trace verification remains |
| 18 Testing | Partial | Unit suites; PostgreSQL/Redis/MongoDB/Kafka/RabbitMQ/OpenSearch native integration harness; RBAC and k6 scenarios; rerunnable API-Gateway E2E covers unique agent/buyer registration, approval, moderation, inventory, cart/order/payment, delivery, completed settlement, return refund and clawback adjustment with readiness preflight and event polling; real local PostgreSQL, Redis and Mongo tests passed on 2026-07-15 with evidence in `docs/native-test-evidence.md` | Kafka, RabbitMQ, OpenSearch and k6 execution plus full native E2E/load evidence remain environment verification |
| 19 Offline deployment | Implemented | PM2/systemd/Nginx, migrations, graceful shutdown, offline setup and consistency verifier; a connected build-machine packager creates a self-contained pnpm-store release with per-file and archive SHA-256 verification while excluding operator secrets; PM2 maps nine distinct `*_DATABASE_URL` values to their owning services and serves the admin dashboard through same-origin Nginx; setup rejects shared/default credentials, and initialization rotates each dedicated PostgreSQL role password; demo seeding targets the shared `ecommerce_read` database and uses a bundled internal asset | Installation and restart/recovery drill is target-environment verification |

## Current high-priority gaps

1. Run the full commerce E2E, integration and k6 suites on the intended native infrastructure and
   retain the results as deployment evidence.

## Local verification commands

```powershell
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:rbac-integration
pnpm load:public
pnpm load:flash-sale
```

Only the first command is expected to be fully offline and daemon-independent.
The remaining commands require the native services described in
`docs/offline-infrastructure.md`.
