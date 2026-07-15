'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, type AuditLog, type PaginatedResult } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const fmt = (d: string) => new Date(d).toLocaleString('ko-KR');

export default function AuditPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (user && user.role !== 'super-admin') router.replace('/dashboard');
  }, [user, router]);

  const { data, error } = useSWR<PaginatedResult<AuditLog>>(
    user?.role === 'super-admin' ? `/api/v1/admin/audit-logs?page=${page}&limit=25` : null,
    makeFetcher(token),
    { refreshInterval: 30000 },
  );

  if (user?.role !== 'super-admin') return null;

  const rows = (data?.items ?? []).filter((l) => {
    const q = search.toLowerCase();
    return !q
      || l.action.toLowerCase().includes(q)
      || l.resource.toLowerCase().includes(q)
      || l.actor_role.toLowerCase().includes(q);
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">감사 로그</h1>
        <p className="text-slate-500 text-sm mt-1">관리자 / super-admin 액션 전체 기록 · 총 {data?.total ?? 0}건</p>
      </div>

      <input
        className="input max-w-xs" placeholder="액션 / 리소스 / 역할 검색"
        value={search} onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error.message}</div>}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">시각</th>
              <th className="th">액터 역할</th>
              <th className="th">액션</th>
              <th className="th">리소스</th>
              <th className="th">대상 ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="td text-xs text-slate-400 whitespace-nowrap">{fmt(l.created_at)}</td>
                <td className="td"><StatusBadge value={l.actor_role} /></td>
                <td className="td font-mono text-xs font-semibold text-slate-700">{l.action}</td>
                <td className="td text-sm text-slate-600">{l.resource}</td>
                <td className="td font-mono text-xs text-slate-400">{l.resource_id?.slice(0, 12) ?? '—'}…</td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={5} className="td text-center text-slate-400 py-12">감사 로그가 없습니다.</td></tr>
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
