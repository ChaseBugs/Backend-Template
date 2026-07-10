'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, apiPatch, type AdminUser, type PaginatedResult } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const ROLES = ['', 'super-admin', 'admin', 'agent', 'user'];

export default function UsersPage() {
  const { token } = useAuth();
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole]     = useState('');

  const key = `/api/v1/admin/users?page=${page}&limit=20`;
  const { data, error } = useSWR<PaginatedResult<AdminUser>>(key, makeFetcher(token), { refreshInterval: 15000 });

  const rows = (data?.items ?? []).filter((u) => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.email.toLowerCase().includes(q) || u.first_name.toLowerCase().includes(q);
    const matchRole   = !role || u.role === role;
    return matchSearch && matchRole;
  });

  async function toggleStatus(user: AdminUser) {
    await apiPatch(`/api/v1/admin/users/${user.id}/status`, token, { isActive: !user.is_active });
    mutate(key);
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">사용자 관리</h1>
        <p className="text-slate-500 text-sm mt-1">전체 {data?.total ?? 0}명</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-xs" placeholder="이메일 / 이름 검색"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input w-40"
          value={role} onChange={(e) => setRole(e.target.value)}
        >
          {ROLES.map((r) => <option key={r} value={r}>{r || '전체 역할'}</option>)}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error.message}</div>}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">이름</th>
              <th className="th">이메일</th>
              <th className="th">역할</th>
              <th className="th">상태</th>
              <th className="th">가입일</th>
              <th className="th">액션</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="td font-medium">{u.first_name} {u.last_name}</td>
                <td className="td text-slate-600">{u.email}</td>
                <td className="td"><StatusBadge value={u.role} /></td>
                <td className="td">
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                    u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {u.is_active ? '활성' : '비활성'}
                  </span>
                </td>
                <td className="td text-slate-400 text-xs">{new Date(u.created_at).toLocaleDateString('ko-KR')}</td>
                <td className="td">
                  <button
                    onClick={() => toggleStatus(u)}
                    className={u.is_active ? 'btn-ghost text-xs py-1 px-2' : 'btn-success text-xs py-1 px-2'}
                    disabled={u.role === 'super-admin'}
                    title={u.role === 'super-admin' ? 'super-admin은 비활성화할 수 없습니다' : ''}
                  >
                    {u.is_active ? '비활성화' : '활성화'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={6} className="td text-center text-slate-400 py-12">사용자가 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {(data?.totalPages ?? 1) > 1 && (
        <div className="flex justify-center gap-2">
          {Array.from({ length: data!.totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={p === page ? 'btn-primary text-xs py-1.5 px-3' : 'btn-outline text-xs py-1.5 px-3'}
            >{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}
