'use client';

import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, type DashboardStats, type RevenueTrend, type AdminOrder } from '@/lib/api';
import StatCard from '@/components/StatCard';
import StatusBadge from '@/components/StatusBadge';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { DeliveryGroup } from '@/lib/api';

// Load chart components client-only (Recharts needs browser env)
const RevenueChart     = dynamic(() => import('@/components/charts/RevenueChart'),     { ssr: false });
const OrderStatusChart = dynamic(() => import('@/components/charts/OrderStatusChart'), { ssr: false });
const AgentStatusChart = dynamic(() => import('@/components/charts/AgentStatusChart'), { ssr: false });

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
const fmt = (d: string) => new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function DashboardPage() {
  const { token, user } = useAuth();
  const fetcher = makeFetcher(token);
  const isSuperAdmin = user?.role === 'super-admin';

  const { data: stats, error: statsErr } = useSWR<DashboardStats>('/api/v1/admin/dashboard', fetcher, { refreshInterval: 30000 });
  const { data: trend }  = useSWR<RevenueTrend[]>('/api/v1/admin/analytics/revenue', fetcher, { refreshInterval: 60000 });
  const { data: orders } = useSWR<{ items: AdminOrder[] }>('/api/v1/admin/orders?page=1&limit=8', fetcher, { refreshInterval: 30000 });
  const { data: pendingAgents }   = useSWR<{ items: unknown[]; total: number }>('/api/v1/agents/pending', fetcher);
  const { data: pendingProducts } = useSWR<{ items: unknown[]; total: number }>('/api/v1/admin/products/pending', fetcher);
  const { data: deliveries } = useSWR<{ statusSummary: { status: string; count: string }[] }>(
    '/api/v1/admin/deliveries?page=1&limit=1',
    fetcher,
    { refreshInterval: 30000 },
  );

  const totalOrders = stats?.ordersByStatus.reduce((s, r) => s + Number(r.count), 0) ?? 0;
  const pendingAgentCount   = pendingAgents?.total ?? 0;
  const pendingProductCount = pendingProducts?.total ?? 0;
  const deliveryStatusSummary = deliveries?.statusSummary ?? [];
  const preparingCount = parseInt(deliveryStatusSummary.find((s) => s.status === 'PREPARING')?.count ?? '0', 10);
  const returnCount    = parseInt(deliveryStatusSummary.find((s) => s.status === 'RETURN_REQUESTED')?.count ?? '0', 10);

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">대시보드</h1>
        <p className="text-slate-500 text-sm mt-1">플랫폼 현황 한눈에 보기</p>
      </div>

      {/* KPI Cards */}
      {statsErr && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
          데이터 로드 실패: {statsErr.message}
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="전체 사용자" icon="👤" color="bg-blue-50" iconColor="text-blue-500"
          value={stats?.totalUsers?.toLocaleString() ?? '—'}
          sub="가입된 일반 소비자"
        />
        <StatCard
          label="총 매출" icon="💰" color="bg-emerald-50" iconColor="text-emerald-500"
          value={stats ? won(stats.totalRevenue) : '—'}
          sub="결제 완료 기준"
        />
        <StatCard
          label="전체 주문" icon="🛒" color="bg-purple-50" iconColor="text-purple-500"
          value={totalOrders.toLocaleString()}
          sub="모든 상태 포함"
        />
        <StatCard
          label="승인 대기" icon="⏳" color="bg-amber-50" iconColor="text-amber-500"
          value={pendingAgentCount + pendingProductCount}
          sub={`에이전트 ${pendingAgentCount} · 상품 ${pendingProductCount}`}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Revenue trend */}
        <div className="card p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-slate-700">매출 추이 (최근 30일)</h2>
            <span className="text-xs text-slate-400">일별 결제 완료 기준</span>
          </div>
          <RevenueChart data={trend ?? []} />
        </div>

        {/* Order status donut */}
        <div className="card p-6">
          <h2 className="font-bold text-slate-700 mb-4">주문 상태 분포</h2>
          <OrderStatusChart data={stats?.ordersByStatus ?? []} />
        </div>
      </div>

      {/* Second row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Agent status */}
        <div className="card p-6">
          <h2 className="font-bold text-slate-700 mb-4">에이전트 현황</h2>
          <AgentStatusChart data={stats?.agentsByStatus ?? []} />
          {pendingAgentCount > 0 && (
            <Link href="/dashboard/agents" className="mt-4 block text-center text-sm text-blue-500 hover:underline font-medium">
              승인 대기 {pendingAgentCount}명 →
            </Link>
          )}
        </div>

        {/* Recent orders */}
        <div className="card lg:col-span-2 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-700">최근 주문</h2>
            <Link href="/dashboard/orders" className="text-sm text-blue-500 hover:underline">전체 보기</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">주문 ID</th>
                  <th className="th">주문자</th>
                  <th className="th">금액</th>
                  <th className="th">상태</th>
                  <th className="th">일시</th>
                </tr>
              </thead>
              <tbody>
                {orders?.items?.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="td font-mono text-xs text-slate-400">{o.id.slice(0, 8)}…</td>
                    <td className="td text-slate-700">{o.user_email}</td>
                    <td className="td font-semibold text-slate-800">{won(o.total_amount)}</td>
                    <td className="td"><StatusBadge value={o.status} /></td>
                    <td className="td text-slate-400 text-xs whitespace-nowrap">{fmt(o.created_at)}</td>
                  </tr>
                ))}
                {!orders?.items?.length && (
                  <tr>
                    <td colSpan={5} className="td text-center text-slate-400 py-8">주문 없음</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pending approvals + delivery alerts */}
      {(pendingAgentCount > 0 || pendingProductCount > 0 || preparingCount > 0 || returnCount > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {pendingAgentCount > 0 && (
            <div className="card p-5 border-l-4 border-amber-400">
              <p className="text-xs text-slate-500">에이전트 승인 대기</p>
              <p className="text-2xl font-bold text-amber-500 mt-1">{pendingAgentCount}명</p>
              <Link href="/dashboard/agents" className="btn-primary mt-3 w-full justify-center text-xs py-1.5">처리하기</Link>
            </div>
          )}
          {pendingProductCount > 0 && (
            <div className="card p-5 border-l-4 border-blue-400">
              <p className="text-xs text-slate-500">상품 승인 대기</p>
              <p className="text-2xl font-bold text-blue-500 mt-1">{pendingProductCount}개</p>
              <Link href="/dashboard/products" className="btn-primary mt-3 w-full justify-center text-xs py-1.5">처리하기</Link>
            </div>
          )}
          {preparingCount > 0 && (
            <div className="card p-5 border-l-4 border-orange-400">
              <p className="text-xs text-slate-500">배송 준비중</p>
              <p className="text-2xl font-bold text-orange-500 mt-1">{preparingCount}건</p>
              <Link href="/dashboard/deliveries?status=PREPARING" className="btn-ghost mt-3 w-full justify-center text-xs py-1.5">배송 현황</Link>
            </div>
          )}
          {returnCount > 0 && (
            <div className="card p-5 border-l-4 border-red-400">
              <p className="text-xs text-slate-500">반품 요청</p>
              <p className="text-2xl font-bold text-red-500 mt-1">{returnCount}건</p>
              <Link href="/dashboard/deliveries" className="btn-ghost mt-3 w-full justify-center text-xs py-1.5">반품 확인</Link>
            </div>
          )}
        </div>
      )}

      {/* Super-admin quick links */}
      {isSuperAdmin && (
        <div className="card p-5 bg-purple-50 border-purple-200">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-purple-600 font-bold text-sm">⭐ Super Admin 전용 메뉴</span>
            <Link href="/dashboard/settlements" className="btn-primary text-xs py-1.5 bg-purple-500 hover:bg-purple-600">정산 관리</Link>
            <Link href="/dashboard/analytics" className="btn-outline text-xs py-1.5 border-purple-300 text-purple-600">통계 분석</Link>
          </div>
        </div>
      )}
    </div>
  );
}
