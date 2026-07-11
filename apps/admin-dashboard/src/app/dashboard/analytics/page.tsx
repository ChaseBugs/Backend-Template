'use client';

import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, type AgentSalesRanking, type LowStockProduct, type UserRegistrationTrend, type RevenueTrend } from '@/lib/api';
import dynamic from 'next/dynamic';

const RevenueChart = dynamic(() => import('@/components/charts/RevenueChart'), { ssr: false });
const UserTrendChart = dynamic(() => import('@/components/charts/UserTrendChart'), { ssr: false });

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

export default function AnalyticsPage() {
  const { token } = useAuth();
  const fetcher = makeFetcher(token);

  const { data: revTrend } = useSWR<RevenueTrend[]>('/api/v1/admin/analytics/revenue', fetcher, { refreshInterval: 60000 });
  const { data: agentRank } = useSWR<AgentSalesRanking[]>('/api/v1/admin/analytics/agents', fetcher, { refreshInterval: 60000 });
  const { data: lowStock }  = useSWR<LowStockProduct[]>('/api/v1/admin/analytics/inventory', fetcher, { refreshInterval: 30000 });
  const { data: userTrend } = useSWR<UserRegistrationTrend[]>('/api/v1/admin/analytics/users', fetcher, { refreshInterval: 60000 });

  const maxSales = Math.max(...(agentRank?.map((a) => a.total_sales) ?? [1]));

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">통계 분석</h1>
        <p className="text-slate-500 text-sm mt-1">플랫폼 주요 지표 및 에이전트 성과 분석</p>
      </div>

      {/* Revenue + User Registration trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="font-bold text-slate-700 mb-4">매출 추이 (최근 30일)</h2>
          <RevenueChart data={revTrend ?? []} />
        </div>
        <div className="card p-6">
          <h2 className="font-bold text-slate-700 mb-4">신규 회원 가입 (최근 30일)</h2>
          <UserTrendChart data={userTrend ?? []} />
        </div>
      </div>

      {/* Agent sales ranking */}
      <div className="card p-6">
        <h2 className="font-bold text-slate-700 mb-5">에이전트 판매 순위 TOP 10</h2>
        {agentRank?.length === 0 && (
          <p className="text-slate-400 text-sm text-center py-8">판매 데이터가 없습니다.</p>
        )}
        <div className="space-y-3">
          {(agentRank ?? []).map((a, i) => (
            <div key={a.id} className="flex items-center gap-4">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                i === 0 ? 'bg-amber-400 text-white' :
                i === 1 ? 'bg-slate-300 text-slate-700' :
                i === 2 ? 'bg-orange-300 text-white' :
                'bg-slate-100 text-slate-500'
              }`}>{i + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-slate-700 truncate">{a.business_name}</span>
                  <span className="text-sm font-bold text-slate-800 ml-2 flex-shrink-0">{won(a.total_sales)}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${maxSales > 0 ? (a.total_sales / maxSales) * 100 : 0}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{a.order_count.toLocaleString()}건</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Low stock alert */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-slate-700">재고 부족 상품 (≤10개)</h2>
          {(lowStock?.length ?? 0) > 0 && (
            <span className="bg-red-100 text-red-600 text-xs font-bold px-2.5 py-1 rounded-full">
              {lowStock?.length}개 위험
            </span>
          )}
        </div>

        {lowStock?.length === 0 && (
          <div className="text-center py-8 text-slate-400">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-sm">재고 부족 상품이 없습니다.</p>
          </div>
        )}

        {(lowStock?.length ?? 0) > 0 && (
          <div className="overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">상품명</th>
                  <th className="th">SKU</th>
                  <th className="th">가용 재고</th>
                  <th className="th">예약 재고</th>
                  <th className="th">위험도</th>
                </tr>
              </thead>
              <tbody>
                {(lowStock ?? []).map((p) => (
                  <tr key={p.product_id} className="hover:bg-slate-50">
                    <td className="td font-medium text-slate-800">{p.product_name}</td>
                    <td className="td font-mono text-xs text-slate-500">{p.sku}</td>
                    <td className="td">
                      <span className={`font-bold ${p.quantity_available === 0 ? 'text-red-600' : p.quantity_available <= 3 ? 'text-orange-500' : 'text-amber-500'}`}>
                        {p.quantity_available}
                      </span>
                    </td>
                    <td className="td text-slate-500">{p.quantity_reserved}</td>
                    <td className="td">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        p.quantity_available === 0 ? 'bg-red-100 text-red-600' :
                        p.quantity_available <= 3 ? 'bg-orange-100 text-orange-600' :
                        'bg-amber-100 text-amber-600'
                      }`}>
                        {p.quantity_available === 0 ? '품절' : p.quantity_available <= 3 ? '위험' : '부족'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
