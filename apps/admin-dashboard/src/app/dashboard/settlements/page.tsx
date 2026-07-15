'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import { apiPatch, makeFetcher, type Settlement, type SettlementAdjustment, type PaginatedResult } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const won = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
const fmt = (d: string) => new Date(d).toLocaleDateString('ko-KR');

export default function SettlementsPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [page, setPage] = useState(1);

  // Redirect non-super-admin users
  useEffect(() => {
    if (user && user.role !== 'super-admin') {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const key = `/api/v1/admin/settlements?page=${page}&limit=20`;
  const { data, error, mutate } = useSWR<PaginatedResult<Settlement>>(
    user?.role === 'super-admin' ? key : null,
    makeFetcher(token),
    { refreshInterval: 30000 },
  );
  const adjustmentKey = '/api/v1/admin/settlement-adjustments?page=1&limit=100';
  const { data: adjustments, error: adjustmentError, mutate: mutateAdjustments } = useSWR<PaginatedResult<SettlementAdjustment>>(
    user?.role === 'super-admin' ? adjustmentKey : null,
    makeFetcher(token),
    { refreshInterval: 30000 },
  );

  if (user?.role !== 'super-admin') {
    return (
      <div className="p-8 flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-4xl mb-3">🔒</p>
          <p className="text-slate-600 font-semibold">Super Admin 전용 메뉴입니다.</p>
        </div>
      </div>
    );
  }

  const totalGross = data?.items?.reduce((s, r) => s + r.gross_amount, 0) ?? 0;
  const totalNet   = data?.items?.reduce((s, r) => s + r.net_amount, 0) ?? 0;
  const totalComm  = data?.items?.reduce((s, r) => s + r.commission_amount, 0) ?? 0;

  async function updateStatus(id: string, status: 'PROCESSING' | 'COMPLETED' | 'HELD') {
    await apiPatch(`/api/v1/admin/settlements/${id}/status`, token, { status });
    await mutate();
  }

  async function updateAdjustmentStatus(id: string, status: 'PROCESSING' | 'COMPLETED' | 'CANCELLED') {
    await apiPatch(`/api/v1/admin/settlement-adjustments/${id}/status`, token, { status });
    await mutateAdjustments();
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">정산 관리</h1>
        <p className="text-slate-500 text-sm mt-1 flex items-center gap-2">
          에이전트 정산 내역 — <span className="bg-purple-100 text-purple-600 text-xs font-bold px-2 py-0.5 rounded-full">Super Admin 전용</span>
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">이번 페이지 총 판매액</p>
          <p className="text-xl font-bold text-slate-800">{won(totalGross)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">수수료 합계</p>
          <p className="text-xl font-bold text-amber-600">{won(totalComm)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-slate-500 mb-1">에이전트 지급액</p>
          <p className="text-xl font-bold text-emerald-600">{won(totalNet)}</p>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error.message}</div>}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">정산 ID</th>
              <th className="th">에이전트</th>
              <th className="th">주문 ID</th>
              <th className="th">총 판매액</th>
              <th className="th">수수료</th>
              <th className="th">지급액</th>
              <th className="th">상태</th>
              <th className="th">정산일</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="td font-mono text-xs text-slate-400">{s.id.slice(0, 12)}…</td>
                <td className="td font-medium text-slate-700">{s.agent_name}</td>
                <td className="td font-mono text-xs text-slate-400">{s.order_id.slice(0, 12)}…</td>
                <td className="td text-slate-800">{won(s.gross_amount)}</td>
                <td className="td text-amber-600">{won(s.commission_amount)}</td>
                <td className="td font-bold text-emerald-600">{won(s.net_amount)}</td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <StatusBadge value={s.status} />
                    {s.status === 'PENDING' && (
                      <button className="btn-outline text-xs py-1 px-2" onClick={() => updateStatus(s.id, 'PROCESSING')}>Process</button>
                    )}
                    {s.status === 'PROCESSING' && (
                      <button className="btn-primary text-xs py-1 px-2" onClick={() => updateStatus(s.id, 'COMPLETED')}>Complete</button>
                    )}
                  </div>
                </td>
                <td className="td text-xs text-slate-400">{fmt(s.created_at)}</td>
              </tr>
            ))}
            {!(data?.items?.length) && !error && (
              <tr><td colSpan={8} className="td text-center text-slate-400 py-12">정산 내역이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {(data?.totalPages ?? 1) > 1 && (
        <div className="flex justify-center gap-2 flex-wrap">
          {Array.from({ length: data!.totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p} onClick={() => setPage(p)}
              className={p === page ? 'btn-primary text-xs py-1.5 px-3' : 'btn-outline text-xs py-1.5 px-3'}
            >{p}</button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Refund clawbacks</h2>
          <p className="text-sm text-slate-500">Amounts recoverable from settlements already paid before a refund completed.</p>
        </div>
        {adjustmentError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{adjustmentError.message}</div>}
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead><tr>
              <th className="th">Agent</th><th className="th">Refund reference</th><th className="th">Refund</th>
              <th className="th">Commission reversal</th><th className="th">Recover</th><th className="th">Status</th><th className="th">Created</th>
            </tr></thead>
            <tbody>
              {(adjustments?.items ?? []).map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="td font-medium text-slate-700">{a.agent_name}</td>
                  <td className="td font-mono text-xs text-slate-500">{a.reference_id}</td>
                  <td className="td">{won(a.gross_amount)}</td>
                  <td className="td text-amber-600">{won(a.commission_reversal)}</td>
                  <td className="td font-bold text-red-600">{won(a.net_amount)}</td>
                  <td className="td"><div className="flex items-center gap-2">
                    <StatusBadge value={a.status} />
                    {a.status === 'PENDING' && <button className="btn-outline text-xs py-1 px-2" onClick={() => updateAdjustmentStatus(a.id, 'PROCESSING')}>Process</button>}
                    {a.status === 'PROCESSING' && <button className="btn-primary text-xs py-1 px-2" onClick={() => updateAdjustmentStatus(a.id, 'COMPLETED')}>Complete</button>}
                  </div></td>
                  <td className="td text-xs text-slate-400">{fmt(a.created_at)}</td>
                </tr>
              ))}
              {!(adjustments?.items?.length) && !adjustmentError && <tr><td colSpan={7} className="td text-center text-slate-400 py-8">No refund clawbacks.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
