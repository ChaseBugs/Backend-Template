# Native test evidence

This file records tests executed against real local daemons rather than mocks.
It does not claim coverage for dependencies listed as unavailable.

## 2026-07-15 Windows workstation

| Dependency | Endpoint | Result | Evidence |
| --- | --- | --- | --- |
| Redis | `127.0.0.1:6379`, integration DB 15 | Passed | `node --test tests/integration/test/redis.test.js`; token-safe distributed lock acquire/release executed atomically |
| MongoDB | `127.0.0.1:27017/ecommerce_read` | Passed | `node --test tests/integration/test/mongodb.test.js`; isolated collection verified ordered bulk projection, replay idempotency and cleanup |
| PostgreSQL | `127.0.0.1:55432/ecommerce` | Passed | Created an isolated PostgreSQL 18 test cluster, applied `infra/postgres/01_init.sql` through `13_review_schema.sql`, and passed `postgres.test.js`, including required-table and per-user idempotency checks |
| Kafka | `127.0.0.1:9092` | Unavailable | TCP port closed and Kafka CLI absent |
| RabbitMQ | `127.0.0.1:5672` | Unavailable | TCP port closed and RabbitMQ CLI absent |
| OpenSearch | `127.0.0.1:9200` | Unavailable | TCP port closed |
| k6 | local executable | Unavailable | Command not installed |

The MongoDB test creates a uniquely named temporary collection and drops it in
`finally`. The Redis test uses a unique lock key and deletes it in `finally`.
The PostgreSQL test cluster is isolated from the pre-existing Windows service:
its data is stored under `C:\codex-tools\backend-template\postgres`, it listens
only on `127.0.0.1:55432`, and the existing server on port 5432 was not changed.

The three available native integration tests were also executed together with
`node --test --test-concurrency=1`; all 3 tests passed on 2026-07-15.

External package installation was attempted after installing the locally cached,
validly signed Eclipse Adoptium JDK 17 MSI. DNS resolves external package hosts,
but outbound IPv4 TCP/443 connections time out, so Kafka, RabbitMQ, OpenSearch,
and k6 binaries could not be downloaded on this workstation.
