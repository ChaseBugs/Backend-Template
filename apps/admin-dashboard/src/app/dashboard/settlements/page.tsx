'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, type Settlement, type PaginatedResult } from '@/lib/api';
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
  const { data, error } = useSWR<PaginatedResult<Settlement>>(
    user?.role === 'super-admin' ? key : null,
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
                <td className="td"><StatusBadge value={s.status} /></td>
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
    </div>
  );
}
