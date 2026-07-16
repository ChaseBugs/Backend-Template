import { normalizeApiResponse } from './api-response.mjs';

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

  const url = path.startsWith(`${BASE}/`) ? path : `${BASE}${path}`;
  const res = await fetch(url, { ...options, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json.error?.message ?? json.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return normalizeApiResponse(json) as T;
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
  payment_id: string | null;
  payment_status: string | null;
  payment_amount: number | null;
  refunded_amount: number | null;
  created_at: string;
}

export interface AgentProfile {
  id: string;
  userId: string;
  businessName: string;
  businessNumber: string;
  commissionRate: number;
  approvalStatus: string;
  rejectionReason?: string;
  createdAt: string;
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
  agent_id: string;
  agent_name?: string;
  name: string;
  price: number;
  sku: string;
  status: string;
  quantity_available?: number;
  rejection_reason?: string;
  created_at: string;
}

export interface AgentStats {
  profile: {
    id: string;
    user_id: string;
    email: string;
    first_name: string;
    last_name: string;
    business_name: string;
    business_number: string;
    commission_rate: number;
    approval_status: string;
    is_active: boolean;
    created_at: string;
  };
  productCounts: { status: string; count: string }[];
  sales: { order_count: number; total_sales: number; commission_earned: number };
  recentOrders: AdminOrder[];
}

export interface DeliveryGroup {
  id: string;
  order_id: string;
  agent_id: string;
  agent_name: string;
  status: string;
  courier_name: string | null;
  tracking_number: string | null;
  shipping_fee: number;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface ReturnRequest {
  id: string;
  delivery_group_id: string;
  user_id: string;
  reason: string;
  status: string;
  refund_amount: number | null;
  agent_name: string;
  created_at: string;
}

export interface AgentSalesRanking {
  id: string;
  business_name: string;
  order_count: number;
  total_sales: number;
}

export interface LowStockProduct {
  product_id: string;
  product_name: string;
  sku: string;
  quantity_available: number;
  quantity_reserved: number;
}

export interface UserRegistrationTrend {
  date: string;
  count: number;
}

export interface Settlement {
  id: string;
  agent_id: string;
  agent_name: string;
  order_id: string;
  gross_amount: number;
  commission_amount: number;
  net_amount: number;
  status: string;
  created_at: string;
}

export interface SettlementAdjustment {
  id: string;
  settlement_id: string;
  refund_id: string;
  agent_id: string;
  agent_name: string;
  order_id: string;
  reference_id: string;
  reason: string;
  gross_amount: number;
  commission_reversal: number;
  net_amount: number;
  status: string;
  processed_at: string | null;
  created_at: string;
}

// Ads service returns its own DTOs (not raw pg rows), so this one is camelCase
// unlike the snake_case types above that mirror admin-service's direct SQL reads.
export interface AdCampaign {
  id: string;
  agentId: string;
  productId: string;
  costPerClick: number;
  dailyBudget: number;
  totalBudget: number;
  spentTotal: number;
  spentToday: number;
  spendDate: string;
  impressionCount: number;
  clickCount: number;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'PAUSED' | 'REJECTED' | 'COMPLETED';
  rejectionReason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
