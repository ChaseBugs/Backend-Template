const BASE = '/api/v1';

export async function apiFetch<T = unknown>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error?.message ?? json.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json.data ?? json;
}

// SWR fetcher factory — generic so TypeScript infers the return type
export function makeFetcher(token: string | null) {
  return <T = unknown>(path: string): Promise<T> => apiFetch<T>(path, token);
}

// Typed helpers
export const apiGet  = <T>(path: string, token: string | null) =>
  apiFetch<T>(path, token);

export const apiPost = <T>(path: string, token: string | null, body: unknown) =>
  apiFetch<T>(path, token, { method: 'POST', body: JSON.stringify(body) });

export const apiPatch = <T>(path: string, token: string | null, body: unknown) =>
  apiFetch<T>(path, token, { method: 'PATCH', body: JSON.stringify(body) });

export const apiDelete = <T>(path: string, token: string | null) =>
  apiFetch<T>(path, token, { method: 'DELETE' });

// ── Response types ────────────────────────────────────────────
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DashboardStats {
  totalUsers: number;
  totalRevenue: number;
  ordersByStatus: { status: string; count: string }[];
  agentsByStatus: { approval_status: string; count: string }[];
}

export interface RevenueTrend {
  date: string;
  revenue: number;
  orders: number;
}

export interface AdminUser {
  id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  created_at: string;
}

export interface AdminOrder {
  id: string;
  user_email: string;
  status: string;
  total_amount: number;
  created_at: string;
}

export interface AgentProfile {
  id: string;
  user_id: string;
  business_name: string;
  business_number: string;
  commission_rate: number;
  approval_status: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  resource: string;
  resource_id: string;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  sku: string;
  status: string;
  created_at: string;
}
