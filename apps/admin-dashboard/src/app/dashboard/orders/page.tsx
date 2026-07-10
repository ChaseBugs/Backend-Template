'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, type AdminOrder, type PaginatedResult } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const won = (n: number) => `₩${n.toLocaleString('ko-KR')}`;
const fmt = (d: string) => new Date(d).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

const STATUS_OPTIONS = ['', 'PENDING', 'CONFIRMED', 'PAYMENT_PENDING', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED'];

export default function OrdersPage() {
  const { token } = useAuth();
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, error } = useSWR<PaginatedResult<AdminOrder>>(
    `/api/v1/admin/orders?page=${page}&limit=20`,
    makeFetcher(token),
    { refreshInterval: 20000 },
  );

  const rows = (data?.items ?? []).filter((o) => {
    const q = search.toLowerCase();
    const matchSearch = !q || o.user_email.toLowerCase().includes(q) || o.id.toLowerCase().includes(q);
    const matchStatus = !status || o.status === status;
    return matchSearch && matchStatus;
  });

  // Summary counts
  const summary = data?.items?.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {}) ?? {};

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">주문 관리</h1>
        <p className="text-slate-500 text-sm mt-1">전체 {data?.total ?? 0}건</p>
      </div>

      {/* Quick status filter pills */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.filter(Boolean).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(status === s ? '' : s)}
            className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition-colors ${
              status === s
                ? 'bg-blue-500 text-white border-blue-500'
                : 'border-slate-200 text-slate-600 hover:border-blue-300'
            }`}
          >
            {s} {summary[s] ? `(${summary[s]})` : ''}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-xs" placeholder="이메일 / 주문 ID 검색"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error.message}</div>}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">주문 ID</th>
              <th className="th">주문자</th>
              <th className="th">금액</th>
              <th className="th">상태</th>
              <th className="th">주문일시</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="td font-mono text-xs text-slate-400 whitespace-nowrap">{o.id.slice(0, 12)}…</td>
                <td className="td text-slate-700">{o.user_email}</td>
                <td className="td font-bold text-slate-800">{won(o.total_amount)}</td>
                <td className="td"><StatusBadge value={o.status} /></td>
                <td className="td text-slate-400 text-xs whitespace-nowrap">{fmt(o.created_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={5} className="td text-center text-slate-400 py-12">주문이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
