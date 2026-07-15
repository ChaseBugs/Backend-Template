# Offline on-premise infrastructure plan

This deployment uses physical servers or internal VMs only. Docker, Kubernetes,
cloud-managed databases, and runtime internet access are not required or used.

## Recommended production topology

| Tier | Nodes | Services | Inbound ports |
|---|---:|---|---|
| Edge | 2 | Nginx | 80, 443 from clients; 22 from management VLAN |
| Application | 3+ | PM2 backend services and admin dashboard | 3000/4001 from local Nginx only; 22 from management VLAN |
| PostgreSQL | 2 | PostgreSQL primary + streaming replica | 5432 from application/admin nodes |
| Redis | 6 | 3 masters + 3 replicas | 6379 and cluster bus 16379 from application/Redis nodes |
| Kafka | 3 | Kafka KRaft brokers/controllers | 9092 from application; 9093 between brokers |
| RabbitMQ | 3 | RabbitMQ quorum cluster | 5672 from application; 25672/4369 between nodes; 15672 management VLAN only |
| Search | 3 | OpenSearch manager/data nodes | 9200 from application/admin; 9300 between search nodes |
| MongoDB | 3 | MongoDB replica set | 27017 from application and between MongoDB nodes |

Production networks should deny every other east-west port by default. Infrastructure
management UIs must never be exposed to the client network. TLS certificates and all
secrets are supplied through the offline release process and rotated independently.

## Offline release contents

On a connected, trusted build machine, create the transfer archive with:

```bash
VERSION=1.0.0 bash scripts/package-offline.sh
```

The command populates `offline/pnpm-store`, excludes operator secrets and generated
runtime data, writes a per-file `RELEASE_MANIFEST.sha256`, and produces both the
release archive and an archive checksum under the sibling `releases/` directory.
Verify the outer `.sha256` file before extracting on removable media. The offline
installer verifies every extracted file against the inner manifest before making
system changes.

Stage the repository plus:

- `offline/pnpm-store/`: populated on a connected build machine using the exact lockfile;
- `offline/env.production`: copy `offline/env.production.example`, then supply
  production endpoints and non-default secrets with mode `0640`. Each PostgreSQL
  service must have its own `*_DATABASE_URL`; a shared `DATABASE_URL` is rejected;
- OS-specific signed package repositories or installation media for Node.js 20+, JDK 17,
  PostgreSQL 16, Redis 7, Kafka 3.8+, RabbitMQ 3.13+, MongoDB 7, OpenSearch 2.x, Nginx,
  PM2, pnpm/Corepack, Prometheus, Grafana, redis_exporter, and kafka_exporter;
- the Jaeger v2 Linux binary staged as `/opt/jaeger/jaeger` (no container
  runtime is used);
- internal CA root and server certificates.

Run `sudo bash scripts/setup-offline.sh --check` before changing the server, then run
the script without `--check`. Once infrastructure daemons are healthy, execute
`scripts/init-all.sh` to apply ordered SQL migrations and configure brokers/search.
When `/etc/ecommerce/backend.env` exists, initialization also validates each URL's
dedicated role name and rotates the nine PostgreSQL service-role passwords before
the application starts. This preserves schema ownership and prevents an admin or
domain service from inheriting another service's write privileges.

## Operational checks

- `pnpm infra:check` validates committed deployment assets without live services.
- `nginx -t` validates the reverse proxy configuration.
- `systemctl status ecommerce-backend` verifies PM2 boot integration.
- Gateway `/ready` must report every downstream service and Redis as `up` before traffic.
- PostgreSQL, Kafka, RabbitMQ, MongoDB, Redis, and OpenSearch require their own backup,
  replication, disk-capacity, certificate-expiry, and quorum alerts.

## Native monitoring configuration

Install Prometheus and Grafana from the staged OS repository, then copy
`infra/prometheus/prometheus.yml` to `/etc/prometheus/prometheus.yml`. Copy the
Grafana provisioning files under `infra/grafana/provisioning` to
`/etc/grafana/provisioning` and the dashboard JSON to
`/var/lib/grafana/dashboards/ecommerce/backend-overview.json`. Run
`redis_exporter` on port 9121 and `kafka_exporter` on port 9308, then restart
Prometheus and Grafana through systemd. Keep ports 9090 and 3000 (Grafana) on
the management VLAN only; the application-facing Nginx configuration does not
expose either service.

Application stdout/error files and `logs/admin-service/audit.log` are rotated
daily (or at 100 MiB) by `/etc/logrotate.d/ecommerce-backend`, retaining 30
compressed generations. The audit logger records actor, role, method, route,
status, request/trace IDs and source IP only; request bodies and credentials are
intentionally excluded.

## Native distributed tracing

The PM2 definition preloads `packages/logger/dist/tracing.js` into all 13 Node
services. Set `OTEL_ENABLED=true` and
`OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` in the production environment
to enable HTTP/Express/database client auto-instrumentation. The application
uses W3C trace context for automatic HTTP propagation and mirrors the active
span trace ID into `x-trace-id` and structured request logs.

`scripts/setup-offline.sh` installs `infra/jaeger/config.yml` and the hardened
`jaeger.service`. The supplied configuration is an all-in-one, memory-backed
profile intended for a single on-premises node and retains up to 100,000 traces.
For a multi-node production deployment, replace only the `jaeger_storage`
backend with an approved persistent backend before enabling the service. The
OTLP ports 4317/4318 and UI port 16686 bind to localhost by default.
