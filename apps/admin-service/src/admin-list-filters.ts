import { BadRequestError } from '@ecommerce/errors';

export interface SqlFilter {
  where: string;
  params: unknown[];
}

const USER_ROLES = new Set(['super-admin', 'admin', 'agent', 'user']);
const ORDER_STATUSES = new Set([
  'PENDING', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'PARTIALLY_SHIPPED',
  'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function scalar(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`${name} must be a single string`);
  return value;
}

function searchTerm(query: Record<string, unknown>): string | undefined {
  const value = scalar(query, 'search')?.trim();
  if (value && value.length > 100) throw new BadRequestError('search must not exceed 100 characters');
  return value || undefined;
}

function like(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function sql(conditions: string[], params: unknown[]): SqlFilter {
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

export function buildUserListFilter(query: Record<string, unknown>, startIndex = 1): SqlFilter {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (condition: (placeholder: string) => string, value: unknown) => {
    const placeholder = `$${startIndex + params.length}`;
    conditions.push(condition(placeholder));
    params.push(value);
  };
  const search = searchTerm(query);
  if (search) add((p) => `(u.email ILIKE ${p} ESCAPE '\\' OR u.first_name ILIKE ${p} ESCAPE '\\' OR u.last_name ILIKE ${p} ESCAPE '\\')`, like(search));
  const role = scalar(query, 'role');
  if (role && !USER_ROLES.has(role)) throw new BadRequestError('Invalid user role filter');
  if (role) add((p) => `u.role = ${p}`, role);
  const active = scalar(query, 'isActive');
  if (active && !['true', 'false'].includes(active)) throw new BadRequestError('isActive must be true or false');
  if (active) add((p) => `u.is_active = ${p}`, active === 'true');
  return sql(conditions, params);
}

function checkedDate(query: Record<string, unknown>, name: string): string | undefined {
  const value = scalar(query, name);
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!DATE.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestError(`${name} must use YYYY-MM-DD`);
  }
  return value;
}

export function buildOrderListFilter(query: Record<string, unknown>, startIndex = 1): SqlFilter {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (condition: (placeholder: string) => string, value: unknown) => {
    const placeholder = `$${startIndex + params.length}`;
    conditions.push(condition(placeholder));
    params.push(value);
  };
  const search = searchTerm(query);
  if (search) add((p) => `(o.id::text ILIKE ${p} ESCAPE '\\' OR u.email ILIKE ${p} ESCAPE '\\')`, like(search));
  const status = scalar(query, 'status');
  if (status && !ORDER_STATUSES.has(status)) throw new BadRequestError('Invalid order status filter');
  if (status) add((p) => `o.status = ${p}`, status);
  const agentId = scalar(query, 'agentId');
  if (agentId && !UUID.test(agentId)) throw new BadRequestError('agentId must be a UUID');
  if (agentId) add((p) => `EXISTS (SELECT 1 FROM "order".order_items oi_filter WHERE oi_filter.order_id = o.id AND oi_filter.agent_id = ${p})`, agentId);
  const dateFrom = checkedDate(query, 'dateFrom');
  const dateTo = checkedDate(query, 'dateTo');
  if (dateFrom && dateTo && dateFrom > dateTo) throw new BadRequestError('dateFrom must not be after dateTo');
  if (dateFrom) add((p) => `o.created_at >= ${p}::date`, dateFrom);
  if (dateTo) add((p) => `o.created_at < (${p}::date + INTERVAL '1 day')`, dateTo);
  return sql(conditions, params);
}
