import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Permission, hasPermission } from '../packages/rbac/dist/index.js';
import { UserRole } from '../packages/shared/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'docs/openapi.json');

const ROLE_ORDER = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.AGENT, UserRole.USER];
const roleTag = (role) => `Role: ${role}`;

// Route source files scanned both for the coverage check and for role derivation.
const routeSources = [
  ['apps/auth-service/src/infrastructure/http/routes/auth.routes.ts', '/api/v1/auth', 'router'],
  ['apps/auth-service/src/infrastructure/http/routes/agent.routes.ts', '/api/v1/agents', 'router'],
  ['apps/auth-service/src/infrastructure/http/routes/user.routes.ts', '/api/v1/users', 'router'],
  ['apps/product-service/src/infrastructure/http/routes/product.routes.ts', '/api/v1/products', 'router'],
  ...['search', 'review', 'notification', 'admin', 'cart', 'order', 'payment', 'delivery', 'inventory', 'ads'].map((service) => [`apps/${service}-service/src/index.ts`, '', 'app']),
];

function normalizeRoutePath(prefix, rawPath) {
  let path = rawPath;
  if (!prefix) {
    if (!path.startsWith('/api/')) return null;
    path = `/api/v1${path.slice(4)}`;
  } else {
    path = `${prefix}${path === '/' ? '' : path}`;
  }
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

// Derives which roles may call each gateway route by reading the actual guards
// in the route code (requirePermission / requireRole / requireApprovedAgent) and
// resolving permissions through the shared RBAC map. Inline `req.user.role` checks
// in service handlers are picked up as a fallback.
async function deriveRoleGuards() {
  const map = new Map();
  for (const [file, prefix, receiver] of routeSources) {
    const source = await readFile(resolve(root, file), 'utf8');
    const expression = new RegExp(`${receiver}\\.(get|post|put|patch|delete)\\(\\s*['\"]([^'\"]+)`, 'g');
    const matches = [...source.matchAll(expression)];
    for (let i = 0; i < matches.length; i += 1) {
      const method = matches[i][1].toUpperCase();
      const path = normalizeRoutePath(prefix, matches[i][2]);
      if (!path) continue;
      const start = matches[i].index;
      const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(source.length, start + 900);
      const block = source.slice(start, end);
      const handlerAt = ['=> {', 'async (', 'controller.', ', (req'].map((s) => block.indexOf(s)).filter((n) => n >= 0);
      const header = block.slice(0, handlerAt.length ? Math.min(...handlerAt) : block.length);

      const roles = new Set();
      for (const pm of header.matchAll(/requirePermission\(\s*Permission\.([A-Z_]+)\s*\)/g)) {
        const perm = Permission[pm[1]];
        if (perm !== undefined) for (const role of ROLE_ORDER) if (hasPermission(role, perm)) roles.add(role);
      }
      for (const rm of header.matchAll(/requireRole\(([^)]*)\)/g)) {
        for (const um of rm[1].matchAll(/UserRole\.([A-Z_]+)/g)) if (UserRole[um[1]]) roles.add(UserRole[um[1]]);
      }
      if (/requireApprovedAgent/.test(header)) roles.add(UserRole.AGENT);
      if (roles.size === 0) {
        for (const lit of block.matchAll(/'(super-admin|admin|agent|user)'/g)) roles.add(lit[1]);
      }

      const key = `${method} ${path}`;
      if (!map.has(key)) map.set(key, new Set());
      for (const role of roles) map.get(key).add(role);
    }
  }
  return map;
}

const rolesByRoute = await deriveRoleGuards();

function rolesForRoute(method, apiPath, isPublic) {
  if (isPublic) return ['public'];
  const derived = rolesByRoute.get(`${method} ${apiPath}`);
  const set = derived && derived.size ? [...derived] : [...ROLE_ORDER];
  const ordered = ROLE_ORDER.filter((role) => set.includes(role));
  return ordered.length ? ordered : [...ROLE_ORDER];
}

const routes = {
  auth: {
    public: ['POST /auth/register', 'POST /auth/login', 'POST /auth/refresh'],
    secured: ['POST /auth/logout', 'GET /auth/me', 'POST /auth/admin/create'],
  },
  agents: {
    public: ['GET /agents/{agentId}/shipping-policy'],
    secured: ['GET /agents', 'GET /agents/pending', 'PATCH /agents/{agentId}/approve', 'PATCH /agents/{agentId}/reject', 'GET /agents/me', 'GET /agents/shipping-policy', 'PUT /agents/shipping-policy'],
  },
  users: { secured: ['GET /users', 'GET /users/{userId}', 'PATCH /users/{userId}/role', 'PATCH /users/{userId}/deactivate', 'PATCH /users/{userId}/activate'] },
  products: {
    public: ['GET /products', 'GET /products/{id}', 'GET /products/catalog/search', 'GET /products/catalog/variants/{variantId}/offers'],
    secured: ['GET /products/pending', 'GET /products/my', 'GET /products/catalog/variants/{variantId}/buybox', 'POST /products', 'PATCH /products/{id}', 'DELETE /products/{id}', 'PATCH /products/{id}/approve', 'PATCH /products/{id}/reject'],
  },
  search: { public: ['GET /search', 'GET /search/popular', 'GET /search/autocomplete'] },
  cart: { secured: ['GET /cart', 'POST /cart/items', 'PATCH /cart/items/{productId}', 'DELETE /cart/items/{productId}', 'DELETE /cart'] },
  orders: { secured: ['POST /orders', 'GET /orders', 'GET /orders/agent/summary', 'GET /orders/{id}', 'PATCH /orders/{id}/cancel'] },
  payments: { secured: ['POST /payments', 'GET /payments/settlements', 'GET /payments/settlements/summary', 'GET /payments/{paymentId}', 'POST /payments/{paymentId}/refund'] },
  inventory: { secured: ['GET /inventory/agent/summary', 'GET /inventory/{productId}', 'PUT /inventory/{productId}', 'PATCH /inventory/{productId}/adjust'] },
  deliveries: { secured: ['GET /deliveries/order/{orderId}', 'GET /deliveries/my', 'GET /deliveries/my/summary', 'GET /deliveries/my/pending', 'PATCH /deliveries/{id}/ship', 'PATCH /deliveries/{id}/deliver', 'PATCH /deliveries/{id}/status', 'POST /deliveries/{id}/confirm', 'POST /deliveries/{id}/return'] },
  notifications: { secured: ['GET /notifications', 'PATCH /notifications/{id}/read'] },
  reviews: {
    public: ['GET /reviews/product/{productId}'],
    secured: ['POST /reviews', 'PATCH /reviews/{id}', 'DELETE /reviews/{id}'],
  },
  admin: { secured: [
    'GET /admin/dashboard', 'GET /admin/users', 'GET /admin/orders', 'GET /admin/products/pending', 'GET /admin/products', 'DELETE /admin/products/{productId}',
    'GET /admin/agents/{agentId}/stats', 'PATCH /admin/agents/{agentId}/commission', 'GET /admin/analytics/revenue',
    'PATCH /admin/users/{userId}/status', 'GET /admin/deliveries', 'GET /admin/returns', 'GET /admin/analytics/agents',
    'GET /admin/analytics/inventory', 'GET /admin/analytics/users', 'GET /admin/settlements',
    'PATCH /admin/settlements/{settlementId}/status', 'GET /admin/settlement-adjustments',
    'PATCH /admin/settlement-adjustments/{adjustmentId}/status', 'PATCH /admin/orders/{orderId}/status',
    'POST /admin/payments/{paymentId}/refund', 'GET /admin/audit-logs',
  ] },
  ads: { secured: [
    'POST /ads/campaigns', 'GET /ads/campaigns/my', 'GET /ads/campaigns', 'GET /ads/campaigns/{id}',
    'PATCH /ads/campaigns/{id}/approve', 'PATCH /ads/campaigns/{id}/reject',
    'PATCH /ads/campaigns/{id}/pause', 'PATCH /ads/campaigns/{id}/resume',
    'POST /ads/campaigns/{id}/click',
  ] },
};

const requestSchemas = {
  'POST /auth/register': {
    required: ['email', 'password', 'firstName', 'lastName'],
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      firstName: { type: 'string', minLength: 1, maxLength: 100 },
      lastName: { type: 'string', minLength: 1, maxLength: 100 },
      phone: { type: 'string', maxLength: 20 },
      role: { type: 'string', enum: ['user', 'agent'], default: 'user' },
      businessName: { type: 'string', minLength: 1, maxLength: 255 },
      businessNumber: { type: 'string', minLength: 1, maxLength: 50 },
    },
    allOf: [{
      if: { properties: { role: { const: 'agent' } }, required: ['role'] },
      then: { required: ['businessName', 'businessNumber'] },
    }],
  },
  'POST /auth/login': { required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } } },
  'POST /auth/refresh': { required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } },
  'POST /auth/logout': { required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } },
  'POST /auth/admin/create': { required: ['email', 'password', 'firstName', 'lastName', 'role'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8, maxLength: 128 }, firstName: { type: 'string', minLength: 1, maxLength: 100 }, lastName: { type: 'string', minLength: 1, maxLength: 100 }, role: { const: 'admin' } } },
  'PATCH /agents/{agentId}/approve': { properties: { commissionRate: { type: 'number', minimum: 0, maximum: 100 } } },
  'PATCH /agents/{agentId}/reject': { required: ['reason'], properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } },
  'PUT /agents/shipping-policy': { required: ['baseShippingFee', 'remoteAreaFee', 'supportedCouriers'], properties: { baseShippingFee: { type: 'integer', minimum: 0 }, freeShippingThreshold: { type: ['integer', 'null'], minimum: 0 }, remoteAreaFee: { type: 'integer', minimum: 0 }, supportedCouriers: { type: 'array', items: { type: 'string' } }, defaultCourier: { type: 'string' } } },
  'PATCH /users/{userId}/role': { required: ['role'], properties: { role: { type: 'string', enum: ['admin', 'user'] } } },
  'POST /products': { required: ['categoryId', 'name', 'description', 'price', 'sku'], properties: { catalogVariantId: { type: 'string', format: 'uuid' }, catalog: { type: 'object', additionalProperties: false, properties: { gtin: { type: 'string', pattern: '^[0-9]{8,14}$' }, manufacturer: { type: 'string', maxLength: 150 }, modelNumber: { type: 'string', maxLength: 100 }, variantName: { type: 'string', maxLength: 255 }, variantGtin: { type: 'string', pattern: '^[0-9]{8,14}$' }, variantAttributes: { type: 'object', additionalProperties: { type: 'string', maxLength: 100 } } } }, categoryId: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 500 }, description: { type: 'string', minLength: 1, maxLength: 10000 }, price: { type: 'number', exclusiveMinimum: 0 }, comparePrice: { type: 'number', exclusiveMinimum: 0 }, brand: { type: 'string', maxLength: 255 }, sku: { type: 'string', minLength: 1, maxLength: 100 }, condition: { type: 'string', enum: ['NEW','OPEN_BOX','REFURBISHED','USED_LIKE_NEW','USED_GOOD','USED_ACCEPTABLE'], default: 'NEW' }, tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 }, default: [] }, images: { type: 'array', maxItems: 10, items: { type: 'string', format: 'uri' }, default: [] } } },
  'PATCH /products/{id}': { minProperties: 1, properties: { categoryId: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 500 }, description: { type: 'string', minLength: 1, maxLength: 10000 }, price: { type: 'number', exclusiveMinimum: 0 }, comparePrice: { type: 'number', exclusiveMinimum: 0 }, brand: { type: 'string', maxLength: 255 }, tags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 100 } }, images: { type: 'array', maxItems: 10, items: { type: 'string', format: 'uri' } } } },
  'PATCH /products/{id}/reject': { required: ['reason'], properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } },
  'POST /cart/items': { required: ['productId', 'quantity'], properties: { productId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1 } } },
  'PATCH /cart/items/{productId}': { required: ['quantity'], properties: { quantity: { type: 'integer', minimum: 0 } } },
  'POST /orders': { required: ['items', 'shippingAddress', 'idempotencyKey'], properties: { items: { type: 'array', minItems: 1, maxItems: 50, description: 'Product IDs must be unique within an order.', items: { type: 'object', additionalProperties: false, required: ['productId', 'quantity'], properties: { productId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1 } } } }, shippingAddress: { type: 'object', additionalProperties: false, required: ['recipientName', 'phone', 'addressLine1', 'city', 'postalCode'], properties: { recipientName: { type: 'string', minLength: 1, maxLength: 100 }, phone: { type: 'string', minLength: 1, maxLength: 20 }, addressLine1: { type: 'string', minLength: 1, maxLength: 255 }, addressLine2: { type: 'string', maxLength: 255 }, city: { type: 'string', minLength: 1, maxLength: 100 }, postalCode: { type: 'string', minLength: 1, maxLength: 20 } } }, couponCode: { type: 'string', minLength: 1, maxLength: 50, pattern: '^[A-Za-z0-9_-]+$' }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 } } },
  'PATCH /orders/{id}/cancel': { required: ['reason'], properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } },
  'POST /payments': { required: ['orderId', 'method', 'idempotencyKey'], properties: { orderId: { type: 'string', format: 'uuid' }, method: { type: 'string', enum: ['CARD', 'BANK_TRANSFER', 'VIRTUAL_ACCOUNT'] }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 255 } } },
  'POST /payments/{paymentId}/refund': { required: ['refundAmount', 'reason', 'idempotencyKey'], properties: { refundAmount: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 } } },
  'PUT /inventory/{productId}': { required: ['quantity'], properties: { quantity: { type: 'integer', minimum: 0 } } },
  'PATCH /inventory/{productId}/adjust': { required: ['delta'], properties: { delta: { type: 'integer', not: { const: 0 } }, note: { type: 'string', maxLength: 500 } } },
  'PATCH /deliveries/{id}/ship': { required: ['courierName', 'trackingNumber'], properties: { courierName: { type: 'string', minLength: 1, maxLength: 100 }, trackingNumber: { type: 'string', minLength: 1, maxLength: 100 } } },
  'PATCH /deliveries/{id}/status': { required: ['status'], properties: { status: { type: 'string', enum: ['PREPARING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURN_REQUESTED', 'RETURNED', 'CANCELLED'] } } },
  'POST /deliveries/{id}/return': { required: ['reason'], properties: { reason: { type: 'string', minLength: 1, maxLength: 1000 } } },
  'POST /reviews': { required: ['orderId', 'productId', 'rating', 'title', 'comment'], properties: { orderId: { type: 'string', format: 'uuid' }, productId: { type: 'string', format: 'uuid' }, rating: { type: 'integer', minimum: 1, maximum: 5 }, title: { type: 'string', minLength: 1, maxLength: 120 }, comment: { type: 'string', minLength: 1, maxLength: 5000 } } },
  'PATCH /reviews/{id}': { minProperties: 1, properties: { rating: { type: 'integer', minimum: 1, maximum: 5 }, title: { type: 'string', minLength: 1, maxLength: 120 }, comment: { type: 'string', minLength: 1, maxLength: 5000 } } },
  'PATCH /admin/agents/{agentId}/commission': { required: ['commissionRate'], properties: { commissionRate: { type: 'number', minimum: 0, maximum: 100 } } },
  'PATCH /admin/users/{userId}/status': { required: ['isActive'], properties: { isActive: { type: 'boolean' } } },
  'PATCH /admin/settlements/{settlementId}/status': { required: ['status'], properties: { status: { type: 'string', enum: ['PROCESSING', 'COMPLETED', 'HELD', 'CANCELLED'] } } },
  'PATCH /admin/settlement-adjustments/{adjustmentId}/status': { required: ['status'], properties: { status: { type: 'string', enum: ['PROCESSING', 'COMPLETED', 'CANCELLED'] } } },
  'PATCH /admin/orders/{orderId}/status': { required: ['status'], properties: { status: { type: 'string', enum: ['PENDING', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED'] } } },
  'POST /admin/payments/{paymentId}/refund': { required: ['refundAmount', 'reason', 'idempotencyKey'], properties: { refundAmount: { type: 'integer', minimum: 1 }, reason: { type: 'string', minLength: 1, maxLength: 500 }, idempotencyKey: { type: 'string', minLength: 1, maxLength: 200 } } },
  'POST /ads/campaigns': { required: ['productId', 'costPerClick', 'dailyBudget', 'totalBudget'], properties: { productId: { type: 'string', format: 'uuid' }, costPerClick: { type: 'integer', exclusiveMinimum: 0, description: 'KRW charged per click' }, dailyBudget: { type: 'integer', exclusiveMinimum: 0 }, totalBudget: { type: 'integer', exclusiveMinimum: 0, description: 'Must be >= dailyBudget' } } },
  'PATCH /ads/campaigns/{id}/reject': { required: ['reason'], properties: { reason: { type: 'string', minLength: 1, maxLength: 500 } } },
};

const bodylessMutations = new Set([
  'PATCH /users/{userId}/deactivate', 'PATCH /users/{userId}/activate',
  'PATCH /products/{id}/approve', 'PATCH /deliveries/{id}/deliver',
  'POST /deliveries/{id}/confirm', 'PATCH /notifications/{id}/read',
  'PATCH /ads/campaigns/{id}/approve', 'PATCH /ads/campaigns/{id}/pause',
  'PATCH /ads/campaigns/{id}/resume', 'POST /ads/campaigns/{id}/click',
]);
const optionalBodies = new Set(['PATCH /agents/{agentId}/approve']);
const createdRoutes = new Set([
  'POST /auth/register', 'POST /auth/admin/create', 'POST /products',
  'POST /orders', 'POST /payments', 'POST /reviews', 'POST /ads/campaigns',
]);
const querySchemas = {
  'GET /products/catalog/search': {
    q: { type: 'string', minLength: 1, maxLength: 200 },
    gtin: { type: 'string', pattern: '^[0-9]{8,14}$' },
  },
  'GET /admin/users': {
    search: { type: 'string', maxLength: 100 },
    role: { type: 'string', enum: ['super-admin', 'admin', 'agent', 'user'] },
    isActive: { type: 'boolean' },
  },
  'GET /admin/orders': {
    search: { type: 'string', maxLength: 100 },
    status: { type: 'string', enum: ['PENDING', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED'] },
    agentId: { type: 'string', format: 'uuid' },
    dateFrom: { type: 'string', format: 'date' },
    dateTo: { type: 'string', format: 'date' },
  },
  'GET /orders/agent/summary': {
    from: { type: 'string', format: 'date-time', description: 'Window start (defaults to 30 days before "to").' },
    to: { type: 'string', format: 'date-time', description: 'Window end (defaults to now).' },
  },
  'GET /ads/campaigns/my': {
    status: { type: 'string', enum: ['PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED'] },
  },
  'GET /ads/campaigns': {
    status: { type: 'string', enum: ['PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED'] },
  },
};

function operationId(method, path) {
  return `${method.toLowerCase()}${path.replace(/[{}]/g, '').split('/').filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1).replace(/-/g, '')).join('')}`;
}

const paths = {};
for (const [tag, access] of Object.entries(routes)) {
  for (const visibility of ['public', 'secured']) {
    for (const route of access[visibility] ?? []) {
      const [method, path] = route.split(' ');
      const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({ name: match[1], in: 'path', required: true, schema: { type: 'string' } }));
      if (method === 'GET' && !path.includes('/{') || ['GET /orders', 'GET /admin/users'].includes(route)) {
        parameters.push({ name: 'page', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } });
        parameters.push({ name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100 } });
      }
      for (const [name, schema] of Object.entries(querySchemas[route] ?? {})) {
        parameters.push({ name, in: 'query', required: false, schema });
      }
      const opRoles = rolesForRoute(method, `/api/v1${path}`, visibility === 'public');
      const operation = {
        tags: [...opRoles.map(roleTag), tag], 'x-roles': opRoles, operationId: operationId(method, path), summary: `${method} ${path}`,
        ...(visibility === 'secured' ? { security: [{ bearerAuth: [] }] } : {}),
        ...(parameters.length ? { parameters } : {}),
        responses: {
          '200': { description: 'Successful response', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } },
          ...(createdRoutes.has(route) ? { '201': { description: 'Resource created', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } } } } } : {}),
          '400': { $ref: '#/components/responses/BadRequest' },
          ...(visibility === 'secured' ? { '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } } : {}),
          '500': { $ref: '#/components/responses/ServerError' },
        },
      };
      if (['POST', 'PUT', 'PATCH'].includes(method) && !bodylessMutations.has(route)) {
        const defined = requestSchemas[route];
        operation.requestBody = { required: !optionalBodies.has(route), content: { 'application/json': { schema: defined ? { type: 'object', additionalProperties: false, ...defined } : { type: 'object', additionalProperties: true } } } };
      }
      paths[`/api/v1${path}`] ??= {};
      paths[`/api/v1${path}`][method.toLowerCase()] = operation;
    }
  }
}

const errorResponse = (description) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } });
const document = {
  openapi: '3.1.0',
  info: { title: 'E-commerce Backend API', version: '1.0.0', description: 'Public API exposed by the API gateway. Internal service-to-service endpoints are intentionally excluded.' },
  servers: [{ url: 'http://localhost:3000', description: 'Local API gateway' }],
  tags: [
    { name: roleTag(UserRole.SUPER_ADMIN), description: 'Endpoints callable by super-admin (full system authority).' },
    { name: roleTag(UserRole.ADMIN), description: 'Endpoints callable by platform admins.' },
    { name: roleTag(UserRole.AGENT), description: 'Endpoints callable by approved seller agents.' },
    { name: roleTag(UserRole.USER), description: 'Endpoints callable by consumers.' },
    { name: roleTag('public'), description: 'No authentication required.' },
    ...Object.keys(routes).map((name) => ({ name, description: `${name} service` })),
  ],
  paths,
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      SuccessResponse: { type: 'object', required: ['success', 'data'], properties: { success: { const: true }, data: {} } },
      ErrorResponse: { type: 'object', required: ['success', 'error'], properties: { success: { const: false }, error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } },
    },
    responses: { BadRequest: errorResponse('Invalid request'), Unauthorized: errorResponse('Authentication required'), Forbidden: errorResponse('Insufficient permission'), ServerError: errorResponse('Internal server error') },
  },
};

const discovered = new Set();
for (const [file, prefix, receiver] of routeSources) {
  const source = await readFile(resolve(root, file), 'utf8');
  const expression = new RegExp(`${receiver}\\.(get|post|put|patch|delete)\\(\\s*['\"]([^'\"]+)`, 'g');
  for (const match of source.matchAll(expression)) {
    const method = match[1].toUpperCase();
    let path = match[2];
    if (!prefix) {
      if (!path.startsWith('/api/')) continue;
      path = `/api/v1${path.slice(4)}`;
    } else {
      path = `${prefix}${path === '/' ? '' : path}`;
    }
    path = path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    discovered.add(`${method} ${path}`);
  }
}
const documented = new Set(Object.entries(paths).flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`)));
const missing = [...discovered].filter((route) => !documented.has(route));
const stale = [...documented].filter((route) => !discovered.has(route));
if (missing.length || stale.length) {
  if (missing.length) console.error(`Undocumented gateway routes:\n${missing.join('\n')}`);
  if (stale.length) console.error(`Stale OpenAPI routes:\n${stale.join('\n')}`);
  process.exit(1);
}

for (const [path, operations] of Object.entries(paths)) {
  for (const [method, operation] of Object.entries(operations)) {
    const schema = operation.requestBody?.content?.['application/json']?.schema;
    if (schema?.additionalProperties === true) {
      throw new Error(`Mutation request is missing an explicit schema: ${method.toUpperCase()} ${path}`);
    }
  }
}
for (const route of createdRoutes) {
  const [method, path] = route.split(' ');
  if (!paths[`/api/v1${path}`]?.[method.toLowerCase()]?.responses?.['201']) {
    throw new Error(`Creation route is missing its HTTP 201 contract: ${route}`);
  }
}
for (const route of bodylessMutations) {
  const [method, path] = route.split(' ');
  if (paths[`/api/v1${path}`]?.[method.toLowerCase()]?.requestBody) {
    throw new Error(`Bodyless mutation unexpectedly documents a request body: ${route}`);
  }
}
const registration = paths['/api/v1/auth/register'].post.requestBody.content['application/json'].schema;
if (!registration.allOf?.[0]?.then?.required?.includes('businessName')
  || !registration.allOf[0].then.required.includes('businessNumber')) {
  throw new Error('Agent registration contract must require both business identity fields');
}

const operationIds = Object.values(paths).flatMap((operations) => Object.values(operations).map((operation) => operation.operationId));
if (new Set(operationIds).size !== operationIds.length) throw new Error('OpenAPI operationId values must be unique');

const rendered = `${JSON.stringify(document, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8').catch(() => '');
  if (current !== rendered) {
    console.error('docs/openapi.json is stale. Run: pnpm openapi:generate');
    process.exit(1);
  }
  console.log(`OpenAPI contract is current (${Object.keys(paths).length} paths).`);
} else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, rendered);
  console.log(`Generated docs/openapi.json (${Object.keys(paths).length} paths).`);
}
