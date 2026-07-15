import { access, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const required = [
  'ecosystem.config.js', 'infra/nginx/nginx.conf', 'infra/systemd/ecommerce-backend.service',
  'scripts/setup-offline.sh', 'scripts/package-offline.sh', 'scripts/init-all.sh', 'scripts/install-systemd.sh',
  'infra/kafka/topics.sh', 'infra/rabbitmq/setup.sh', 'infra/opensearch/setup.sh',
  'infra/opensearch/products-index.json', 'infra/opensearch/users-index.json', 'infra/opensearch/agents-index.json',
  'infra/prometheus/prometheus.yml', 'infra/grafana/provisioning/datasources/prometheus.yml',
  'infra/grafana/provisioning/dashboards/ecommerce.yml', 'infra/grafana/dashboards/backend-overview.json',
  'infra/logrotate/ecommerce-backend',
  'infra/jaeger/config.yml', 'infra/systemd/jaeger.service',
  'docs/offline-infrastructure.md',
  'tests/integration/test/postgres.test.js', 'tests/integration/test/redis.test.js', 'tests/integration/test/mongodb.test.js', 'tests/integration/test/kafka.test.js',
  'tests/integration/test/rabbitmq.test.js', 'tests/integration/test/opensearch.test.js',
  'tests/integration/e2e/full-commerce.e2e.js',
  'tests/load/public-read.js', 'tests/load/flash-sale.js', 'tests/load/rbac-boundaries.js',
  'apps/web-demo/public/product-placeholder.svg',
  'offline/env.production.example',
];
for (const file of required) await access(resolve(root, file));

const rootPackage = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (!rootPackage.scripts?.['test:e2e']) throw new Error('Root package is missing the native full-commerce E2E command');

const demoSeed = await readFile(resolve(root, 'scripts/seed-demo.js'), 'utf8');
if (!demoSeed.includes('mongodb://localhost:27017/ecommerce_read')) throw new Error('Demo seed must target the shared read-model database');
if (demoSeed.includes('via.placeholder.com')) throw new Error('Demo seed must not depend on an Internet image service');
if (!demoSeed.includes('DEMO_ASSET_BASE_URL')) throw new Error('Demo seed must support an internal asset origin');
const offlinePackager = await readFile(resolve(root, 'scripts/package-offline.sh'), 'utf8');
for (const requirement of ['pnpm fetch --frozen-lockfile', 'RELEASE_MANIFEST.sha256', "--exclude='offline/env.production'"]) {
  if (!offlinePackager.includes(requirement)) throw new Error(`Offline packager is missing: ${requirement}`);
}
const offlineInstaller = await readFile(resolve(root, 'scripts/setup-offline.sh'), 'utf8');
if (!offlineInstaller.includes('sha256sum --check --strict RELEASE_MANIFEST.sha256')) {
  throw new Error('Offline installer must verify the release manifest');
}

const grafanaDashboard = JSON.parse(await readFile(resolve(root, 'infra/grafana/dashboards/backend-overview.json'), 'utf8'));
for (const title of ['API latency P50/P95/P99', 'Kafka consumer lag', 'API calls by role', 'Inventory reservation failure ratio', 'Agent order throughput']) {
  if (!grafanaDashboard.panels?.some((panel) => panel.title === title)) throw new Error(`Grafana dashboard is missing panel: ${title}`);
}
const logrotate = await readFile(resolve(root, 'infra/logrotate/ecommerce-backend'), 'utf8');
for (const requirement of ['rotate 30', 'compress', 'copytruncate', 'su ecommerce ecommerce']) {
  if (!logrotate.includes(requirement)) throw new Error(`Logrotate config is missing: ${requirement}`);
}

const sqlFiles = (await readdir(resolve(root, 'infra/postgres'))).filter((file) => file.endsWith('.sql')).sort();
const expectedSql = ['01_init.sql', '02_auth_schema.sql', '03_product_schema.sql', '04_inventory_schema.sql', '05_order_schema.sql', '06_payment_schema.sql', '07_delivery_schema.sql', '08_notification_schema.sql', '09_admin_schema.sql', '10_admin_grants.sql', '11_notification_multi_recipient.sql', '12_delivery_delay_alert.sql', '13_review_schema.sql', '14_marketplace_catalog.sql'];
if (JSON.stringify(sqlFiles) !== JSON.stringify(expectedSql)) {
  throw new Error(`PostgreSQL migrations must remain explicitly ordered: ${expectedSql.join(', ')}`);
}

const appDirs = new Set((await readdir(resolve(root, 'apps'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
const processConfig = await readFile(resolve(root, 'ecosystem.config.js'), 'utf8');
const managed = [...processConfig.matchAll(/service\('([^']+)'/g)].map((match) => match[1]);
const servicePorts = new Map([...processConfig.matchAll(/service\('([^']+)',\s*(\d+)/g)].map((match) => [match[1], Number(match[2])]));
const runtimeApps = [...appDirs].filter((name) => name !== 'web-demo');
const missingProcesses = runtimeApps.filter((name) => !managed.includes(name));
if (missingProcesses.length) throw new Error(`PM2 does not manage: ${missingProcesses.join(', ')}`);

for (const [service, port] of servicePorts) {
  const examplePath = resolve(root, 'apps', service, '.env.example');
  const example = await readFile(examplePath, 'utf8');
  const configuredPort = Number(example.match(/^PORT=(\d+)$/m)?.[1]);
  if (configuredPort !== port) throw new Error(`${service} port differs between PM2 (${port}) and .env.example (${configuredPort || 'missing'})`);
}
const gatewayEnvironment = await readFile(resolve(root, 'apps/api-gateway/.env.example'), 'utf8');
const upstreamNames = {
  'auth-service': 'AUTH_SERVICE_URL', 'product-service': 'PRODUCT_SERVICE_URL',
  'order-service': 'ORDER_SERVICE_URL', 'payment-service': 'PAYMENT_SERVICE_URL',
  'cart-service': 'CART_SERVICE_URL', 'search-service': 'SEARCH_SERVICE_URL',
  'inventory-service': 'INVENTORY_SERVICE_URL', 'admin-service': 'ADMIN_SERVICE_URL',
  'notification-service': 'NOTIFICATION_SERVICE_URL', 'delivery-service': 'DELIVERY_SERVICE_URL',
  'review-service': 'REVIEW_SERVICE_URL',
};
for (const [service, variable] of Object.entries(upstreamNames)) {
  const expected = `http://localhost:${servicePorts.get(service)}`;
  const actual = gatewayEnvironment.match(new RegExp(`^${variable}=(.+)$`, 'm'))?.[1]?.trim();
  if (actual !== expected) throw new Error(`${variable} must match the PM2 port for ${service}: ${expected}`);
}

const databaseAssignments = {
  'auth-service': ['AUTH_DATABASE_URL', 'auth_svc'],
  'product-service': ['PRODUCT_DATABASE_URL', 'product_svc'],
  'order-service': ['ORDER_DATABASE_URL', 'order_svc'],
  'payment-service': ['PAYMENT_DATABASE_URL', 'payment_svc'],
  'inventory-service': ['INVENTORY_DATABASE_URL', 'inventory_svc'],
  'admin-service': ['ADMIN_DATABASE_URL', 'admin_svc'],
  'notification-service': ['NOTIFICATION_DATABASE_URL', 'notification_svc'],
  'delivery-service': ['DELIVERY_DATABASE_URL', 'delivery_svc'],
  'review-service': ['REVIEW_DATABASE_URL', 'review_svc'],
};
process.env.JWT_SECRET = 'j'.repeat(64);
process.env.INTERNAL_SERVICE_TOKEN = 'i'.repeat(32);
process.env.ALLOWED_ORIGINS = 'https://commerce.internal.test';
for (const [, [variable, role]] of Object.entries(databaseAssignments)) {
  process.env[variable] = `postgresql://${role}:verification-password@localhost:5432/ecommerce`;
}
const require = createRequire(import.meta.url);
const ecosystem = require(resolve(root, 'ecosystem.config.js'));
for (const [service, [variable]] of Object.entries(databaseAssignments)) {
  const app = ecosystem.apps.find((candidate) => candidate.name === service);
  if (app?.env?.DATABASE_URL !== process.env[variable]) throw new Error(`${service} does not receive ${variable} as DATABASE_URL`);
}
const productionEnvironmentExample = await readFile(resolve(root, 'offline/env.production.example'), 'utf8');
for (const [, [variable]] of Object.entries(databaseAssignments)) {
  if (!new RegExp(`^${variable}=postgresql://`, 'm').test(productionEnvironmentExample)) throw new Error(`Production environment example is missing ${variable}`);
}
if (/^DATABASE_URL=/m.test(productionEnvironmentExample)) throw new Error('Production environment example must not define a shared DATABASE_URL');

const readinessRequirements = {
  'auth-service': ['postgres', 'redis', 'kafka-producer'],
  'product-service': ['postgres', 'redis', 'mongodb', 'kafka-producer'],
  'order-service': ['postgres', 'kafka-producer', 'kafka-consumer'],
  'payment-service': ['postgres', 'redis', 'kafka-producer', 'kafka-consumer'],
  'cart-service': ['redis', 'kafka'],
  'search-service': ['opensearch', 'redis', 'kafka-consumer'],
  'inventory-service': ['postgres', 'redis', 'kafka-producer', 'kafka-consumer'],
  'admin-service': ['postgres', 'kafka'],
  'notification-service': ['postgres', 'rabbitmq', 'kafka-consumer'],
  'delivery-service': ['postgres', 'kafka-producer', 'kafka-consumer'],
  'review-service': ['postgres', 'kafka'],
};
for (const [service, dependencies] of Object.entries(readinessRequirements)) {
  const source = await readFile(resolve(root, 'apps', service, 'src/index.ts'), 'utf8');
  for (const dependency of dependencies) {
    if (!source.includes(`name: '${dependency}'`)) throw new Error(`${service} readiness is missing ${dependency}`);
  }
}

for (const file of (await readdir(resolve(root, 'scripts'))).filter((name) => name.endsWith('.sh'))) {
  const content = await readFile(resolve(root, 'scripts', file));
  if (!content.toString('utf8').startsWith('#!/usr/bin/env bash')) throw new Error(`${file} must use the portable bash shebang`);
  if (content.includes(13)) throw new Error(`${file} contains CRLF line endings`);
}

const unit = await readFile(resolve(root, 'infra/systemd/ecommerce-backend.service'), 'utf8');
for (const requirement of ['After=network-online.target', 'Restart=on-failure', 'NoNewPrivileges=true']) {
  if (!unit.includes(requirement)) throw new Error(`systemd unit is missing ${requirement}`);
}
const jaegerUnit = await readFile(resolve(root, 'infra/systemd/jaeger.service'), 'utf8');
for (const requirement of ['--config /etc/jaeger/config.yml', 'NoNewPrivileges=true', 'ProtectSystem=strict']) {
  if (!jaegerUnit.includes(requirement)) throw new Error(`Jaeger unit is missing: ${requirement}`);
}
const jaegerConfig = await readFile(resolve(root, 'infra/jaeger/config.yml'), 'utf8');
for (const requirement of ['receivers:', 'otlp:', 'jaeger_storage_exporter:', '127.0.0.1}:4318']) {
  if (!jaegerConfig.includes(requirement)) throw new Error(`Jaeger config is missing: ${requirement}`);
}
const nginx = await readFile(resolve(root, 'infra/nginx/nginx.conf'), 'utf8');
for (const [label, requirement] of [['TLS 1.2/1.3', /ssl_protocols\s+TLSv1\.2\s+TLSv1\.3/], ['rate limiting', /limit_req_zone/], ['reverse proxy', /proxy_pass/]]) {
  if (!requirement.test(nginx)) throw new Error(`Nginx config is missing ${label}`);
}
for (const requirement of ['upstream admin_dashboard', 'server 127.0.0.1:4001', 'proxy_pass         http://admin_dashboard']) {
  if (!nginx.includes(requirement)) throw new Error(`Nginx admin dashboard routing is missing: ${requirement}`);
}
console.log(`Infrastructure assets are consistent (${managed.length} PM2 services, ${sqlFiles.length} SQL migrations).`);
