'use client';

import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, apiPatch, type Product, type PaginatedResult, type AgentProfile } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const won = (n: number) => `₩${n.toLocaleString('ko-KR')}`;
const STATUS_OPTIONS = ['', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE', 'REJECTED'];

export default function ProductsPage() {
  const { token } = useAuth();
  const fetcher = makeFetcher(token);

  const [page, setPage]         = useState(1);
  const [status, setStatus]     = useState('');
  const [agentId, setAgentId]   = useState('');
  const [search, setSearch]     = useState('');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason]     = useState('');
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  const key = `/api/v1/admin/products?page=${page}&limit=15${status ? `&status=${status}` : ''}${agentId ? `&agentId=${agentId}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
  const { data, error } = useSWR<PaginatedResult<Product> & { statusSummary: { status: string; count: string }[] }>(
    key, fetcher, { refreshInterval: 15000 },
  );

  // load all approved agents for the agent filter dropdown
  const { data: agents } = useSWR<PaginatedResult<AgentProfile>>(
    '/api/v1/agents?status=APPROVED&limit=100',
    fetcher,
  );

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  async function approve(id: string) {
    try {
      await apiPatch(`/api/v1/products/${id}/approve`, token, {});
      globalMutate(key);
      showToast('상품이 승인되었습니다.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '오류가 발생했습니다.', false);
    }
  }

  async function reject(id: string) {
    if (!reason.trim()) return;
    try {
      await apiPatch(`/api/v1/products/${id}/reject`, token, { reason });
      setRejectId(null);
      setReason('');
      globalMutate(key);
      showToast('상품이 거절되었습니다.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '오류가 발생했습니다.', false);
    }
  }

  const statusSummary = data?.statusSummary ?? [];
  const products = data?.items ?? [];

  return (
    <div className="p-8 space-y-6">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold
          ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-slate-800">상품 관리</h1>
        <p className="text-slate-500 text-sm mt-1">전체 {data?.total ?? 0}개</p>
      </div>

      {/* Status summary pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setStatus(''); setPage(1); }}
          className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition-colors ${
            !status ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-200 text-slate-600 hover:border-slate-400'
          }`}
        >
          전체
        </button>
        {STATUS_OPTIONS.filter(Boolean).map((s) => {
          const cnt = statusSummary.find((r) => r.status === s)?.count ?? '0';
          const isActive = status === s;
          return (
            <button
              key={s}
              onClick={() => { setStatus(isActive ? '' : s); setPage(1); }}
              className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition-colors ${
                isActive
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'border-slate-200 text-slate-600 hover:border-blue-300'
              }`}
            >
              {s === 'PENDING_APPROVAL' ? '승인대기' : s === 'ACTIVE' ? '판매중' : s === 'INACTIVE' ? '비활성' : '거절'} ({cnt})
            </button>
          );
        })}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-xs" placeholder="상품명 / SKU 검색"
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="input w-52"
          value={agentId} onChange={(e) => { setAgentId(e.target.value); setPage(1); }}
        >
          <option value="">전체 에이전트</option>
          {(agents?.items ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.businessName}</option>
          ))}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error.message}</div>}

      {/* Products table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">상품명</th>
              <th className="th">에이전트</th>
              <th className="th">가격</th>
              <th className="th">SKU</th>
              <th className="th">재고</th>
              <th className="th">상태</th>
              <th className="th">등록일</th>
              <th className="th">액션</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="td font-medium text-slate-800 max-w-xs">
                  <div className="truncate">{p.name}</div>
                  {p.rejection_reason && (
                    <div className="text-xs text-red-500 truncate mt-0.5">거절: {p.rejection_reason}</div>
                  )}
                </td>
                <td className="td text-slate-600 text-sm">{p.agent_name ?? '—'}</td>
                <td className="td font-semibold text-slate-800">{won(p.price)}</td>
                <td className="td font-mono text-xs text-slate-500">{p.sku}</td>
                <td className="td text-center">
                  <span className={`font-bold text-sm ${
                    (p.quantity_available ?? 0) === 0 ? 'text-red-500' :
                    (p.quantity_available ?? 0) <= 5 ? 'text-amber-500' : 'text-slate-700'
                  }`}>
                    {p.quantity_available ?? '—'}
                  </span>
                </td>
                <td className="td"><StatusBadge value={p.status} /></td>
                <td className="td text-xs text-slate-400">{new Date(p.created_at).toLocaleDateString('ko-KR')}</td>
                <td className="td">
                  {p.status === 'PENDING_APPROVAL' && (
                    <div className="flex gap-1">
                      <button onClick={() => approve(p.id)} className="btn-success text-xs py-1 px-2">승인</button>
                      <button onClick={() => setRejectId(p.id)} className="btn-danger text-xs py-1 px-2">거절</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {products.length === 0 && !error && (
              <tr><td colSpan={8} className="td text-center text-slate-400 py-12">상품이 없습니다.</td></tr>
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

      {/* Reject modal */}
      {rejectId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-bold text-slate-800 text-lg mb-4">상품 거절 사유</h3>
            <textarea
              className="input h-28 resize-none mb-4"
              placeholder="에이전트에게 전달할 거절 사유..."
              value={reason} onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-2">
              <button onClick={() => { setRejectId(null); setReason(''); }} className="btn-outline flex-1 justify-center">취소</button>
              <button onClick={() => reject(rejectId)} disabled={!reason.trim()} className="btn-danger flex-1 justify-center">거절 확정</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
