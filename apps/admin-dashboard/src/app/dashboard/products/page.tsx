'use client';

import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, apiPatch, type Product, type PaginatedResult } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const won = (n: number) => `₩${n.toLocaleString('ko-KR')}`;

export default function ProductsPage() {
  const { token } = useAuth();
  const [page, setPage]     = useState(1);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason]     = useState('');

  const key = `/api/v1/admin/products/pending?page=${page}&limit=12`;
  const { data, error } = useSWR<PaginatedResult<Product>>(key, makeFetcher(token), { refreshInterval: 15000 });

  async function approve(id: string) {
    await apiPatch(`/api/v1/products/${id}/approve`, token, {});
    globalMutate(key);
  }

  async function reject(id: string) {
    if (!reason.trim()) return;
    await apiPatch(`/api/v1/products/${id}/reject`, token, { reason });
    setRejectId(null);
    setReason('');
    globalMutate(key);
  }

  const products = data?.items ?? [];

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">상품 승인 관리</h1>
        <p className="text-slate-500 text-sm mt-1">승인 대기 {data?.total ?? 0}개</p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error.message}</div>}

      {products.length === 0 && !error ? (
        <div className="card p-16 text-center text-slate-400">
          <p className="text-4xl mb-3">✅</p>
          <p>승인 대기 상품이 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {products.map((p) => (
            <div key={p.id} className="card p-5 flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-bold text-slate-800 leading-tight flex-1 mr-2">{p.name}</h3>
                <StatusBadge value={p.status} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm text-slate-600 flex-1 mb-4">
                <div><p className="text-slate-400 text-xs">가격</p><p className="font-bold text-slate-800">{won(p.price)}</p></div>
                <div><p className="text-slate-400 text-xs">SKU</p><p className="font-mono text-xs">{p.sku}</p></div>
                <div className="col-span-2"><p className="text-slate-400 text-xs">등록일</p><p>{new Date(p.created_at).toLocaleDateString('ko-KR')}</p></div>
              </div>
              <div className="flex gap-2 mt-auto">
                <button onClick={() => approve(p.id)} className="btn-success flex-1 justify-center text-sm">
                  ✓ 승인
                </button>
                <button onClick={() => setRejectId(p.id)} className="btn-danger flex-1 justify-center text-sm">
                  ✗ 거절
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {(data?.totalPages ?? 1) > 1 && (
        <div className="flex justify-center gap-2">
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
