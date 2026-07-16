'use client';

import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, apiPatch, type AdCampaign, type PaginatedResult } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const TABS = ['PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'REJECTED', 'COMPLETED'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  PENDING_APPROVAL: '승인 대기',
  ACTIVE: '진행중',
  PAUSED: '일시정지',
  REJECTED: '거절됨',
  COMPLETED: '예산 소진',
};

const won = (n: number) => `₩${n.toLocaleString('ko-KR')}`;
const shortId = (id: string) => (id.length > 8 ? id.slice(0, 8) : id);

export default function AdsPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('PENDING_APPROVAL');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const fetcher = makeFetcher(token);
  const keyFor = (status: Tab) => `/api/v1/ads/campaigns?status=${status}&limit=50`;
  const keys = TABS.map(keyFor);

  const results = Object.fromEntries(
    TABS.map((t) => [t, useSWR<PaginatedResult<AdCampaign>>(keyFor(t), fetcher, { refreshInterval: 20000 })]),
  ) as Record<Tab, ReturnType<typeof useSWR<PaginatedResult<AdCampaign>>>>;

  const current = results[tab];
  const items = current.data?.items ?? [];

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  function refreshAll() {
    keys.forEach((k) => globalMutate(k));
  }

  async function approve(id: string) {
    try {
      await apiPatch(`/api/v1/ads/campaigns/${id}/approve`, token, {});
      refreshAll();
      showToast('캠페인이 승인되었습니다.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '오류가 발생했습니다.', false);
    }
  }

  async function reject(id: string) {
    if (!reason.trim()) return;
    try {
      await apiPatch(`/api/v1/ads/campaigns/${id}/reject`, token, { reason });
      setRejectId(null);
      setReason('');
      refreshAll();
      showToast('캠페인이 거절되었습니다.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '오류가 발생했습니다.', false);
    }
  }

  return (
    <div className="p-8 space-y-6">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold transition-all
          ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-slate-800">광고 관리</h1>
        <p className="text-slate-500 text-sm mt-1">에이전트 스폰서 상품(CPC) 캠페인 승인 및 현황</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {TAB_LABELS[t]} {results[t].data ? `(${results[t].data!.total})` : ''}
          </button>
        ))}
      </div>

      {current.error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{current.error.message}</div>
      )}

      {items.length === 0 ? (
        <div className="card p-16 text-center text-slate-400">
          <p className="text-4xl mb-3">📣</p>
          <p>해당 상태의 캠페인이 없습니다.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((c) => {
            const ctr = c.impressionCount > 0 ? ((c.clickCount / c.impressionCount) * 100).toFixed(2) : '0.00';
            return (
              <div key={c.id} className="card p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-slate-800 text-lg">상품 {shortId(c.productId)}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">에이전트 {shortId(c.agentId)} · 등록일 {new Date(c.createdAt).toLocaleDateString('ko-KR')}</p>
                  </div>
                  <StatusBadge value={c.status} />
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm mb-3">
                  <div><p className="text-slate-400 text-xs">CPC</p><p className="font-semibold">{won(c.costPerClick)}</p></div>
                  <div><p className="text-slate-400 text-xs">일 예산</p><p className="font-semibold">{won(c.dailyBudget)}</p></div>
                  <div><p className="text-slate-400 text-xs">총 예산</p><p className="font-semibold">{won(c.totalBudget)}</p></div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm mb-4">
                  <div><p className="text-slate-400 text-xs">노출</p><p className="font-semibold">{c.impressionCount.toLocaleString('ko-KR')}</p></div>
                  <div><p className="text-slate-400 text-xs">클릭 (CTR)</p><p className="font-semibold">{c.clickCount.toLocaleString('ko-KR')} ({ctr}%)</p></div>
                  <div><p className="text-slate-400 text-xs">누적 지출</p><p className="font-semibold">{won(c.spentTotal)}</p></div>
                </div>

                {tab === 'PENDING_APPROVAL' && (
                  <div className="flex gap-2">
                    <button onClick={() => approve(c.id)} className="btn-success flex-1 justify-center text-sm">✓ 승인</button>
                    <button onClick={() => setRejectId(c.id)} className="btn-danger flex-1 justify-center text-sm">✗ 거절</button>
                  </div>
                )}

                {tab === 'REJECTED' && c.rejectionReason && (
                  <div className="mt-2 p-3 bg-red-50 rounded-lg text-xs text-red-600">거절 사유: {c.rejectionReason}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {rejectId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-bold text-slate-800 text-lg mb-4">거절 사유 입력</h3>
            <textarea
              className="input h-28 resize-none mb-4"
              placeholder="에이전트에게 전달할 거절 사유를 입력하세요..."
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
