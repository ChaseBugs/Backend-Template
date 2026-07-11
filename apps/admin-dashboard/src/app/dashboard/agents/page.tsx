'use client';

import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, apiPatch, type AgentProfile, type PaginatedResult } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const TABS = ['PENDING', 'APPROVED', 'REJECTED'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  PENDING: '대기',
  APPROVED: '승인됨',
  REJECTED: '거절됨',
};

export default function AgentsPage() {
  const { token, user }  = useAuth();
  const isSuperAdmin = user?.role === 'super-admin';
  const [tab, setTab]           = useState<Tab>('PENDING');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason]     = useState('');
  const [commission, setCommission] = useState<{ id: string; rate: string } | null>(null);
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null);

  const fetcher = makeFetcher(token);

  const pendingKey  = '/api/v1/agents?status=PENDING&limit=25';
  const approvedKey = '/api/v1/agents?status=APPROVED&limit=25';
  const rejectedKey = '/api/v1/agents?status=REJECTED&limit=25';

  const { data: pending,  error: pendingErr  } = useSWR<PaginatedResult<AgentProfile>>(pendingKey,  fetcher, { refreshInterval: 15000 });
  const { data: approved, error: approvedErr } = useSWR<PaginatedResult<AgentProfile>>(approvedKey, fetcher, { refreshInterval: 30000 });
  const { data: rejected, error: rejectedErr } = useSWR<PaginatedResult<AgentProfile>>(rejectedKey, fetcher, { refreshInterval: 30000 });

  const currentData = tab === 'PENDING' ? pending : tab === 'APPROVED' ? approved : rejected;
  const currentErr  = tab === 'PENDING' ? pendingErr : tab === 'APPROVED' ? approvedErr : rejectedErr;

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  async function approve(id: string) {
    try {
      await apiPatch(`/api/v1/agents/${id}/approve`, token, {});
      globalMutate(pendingKey);
      globalMutate(approvedKey);
      showToast('에이전트가 승인되었습니다.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '오류가 발생했습니다.', false);
    }
  }

  async function reject(id: string) {
    if (!reason.trim()) return;
    try {
      await apiPatch(`/api/v1/agents/${id}/reject`, token, { reason });
      setRejectId(null);
      setReason('');
      globalMutate(pendingKey);
      globalMutate(rejectedKey);
      showToast('에이전트가 거절되었습니다.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '오류가 발생했습니다.', false);
    }
  }

  async function updateCommission(id: string, rate: string) {
    try {
      await apiPatch(`/api/v1/admin/agents/${id}/commission`, token, { commissionRate: parseFloat(rate) });
      setCommission(null);
      globalMutate(approvedKey);
      showToast('수수료율이 업데이트되었습니다.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '오류가 발생했습니다.', false);
    }
  }

  const items = currentData?.items ?? [];

  return (
    <div className="p-8 space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold transition-all
          ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-slate-800">에이전트 관리</h1>
        <p className="text-slate-500 text-sm mt-1">판매자 가입 승인 및 수수료 설정</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => {
          const count = t === 'PENDING' ? pending?.total : t === 'APPROVED' ? approved?.total : rejected?.total;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {TAB_LABELS[t]} {count != null ? `(${count})` : ''}
            </button>
          );
        })}
      </div>

      {currentErr && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{currentErr.message}</div>
      )}

      {/* Agent cards */}
      {items.length === 0 ? (
        <div className="card p-16 text-center text-slate-400">
          <p className="text-4xl mb-3">{tab === 'PENDING' ? '✅' : tab === 'APPROVED' ? '🏪' : '❌'}</p>
          <p>{tab === 'PENDING' ? '승인 대기 에이전트가 없습니다.' : tab === 'APPROVED' ? '승인된 에이전트가 없습니다.' : '거절된 에이전트가 없습니다.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((a) => (
            <div key={a.id} className="card p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">{a.businessName}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">사업자번호: {a.businessNumber}</p>
                </div>
                <StatusBadge value={a.approvalStatus} />
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div><p className="text-slate-400 text-xs">수수료율</p><p className="font-semibold">{a.commissionRate}%</p></div>
                <div><p className="text-slate-400 text-xs">신청일</p><p className="font-semibold">{new Date(a.createdAt).toLocaleDateString('ko-KR')}</p></div>
              </div>

              {tab === 'PENDING' && (
                <div className="flex gap-2">
                  <button onClick={() => approve(a.id)} className="btn-success flex-1 justify-center text-sm">✓ 승인</button>
                  <button onClick={() => setRejectId(a.id)} className="btn-danger flex-1 justify-center text-sm">✗ 거절</button>
                  {isSuperAdmin && (
                    <button
                      onClick={() => setCommission({ id: a.id, rate: String(a.commissionRate) })}
                      className="btn-ghost text-sm px-3" title="수수료 수정"
                    >%</button>
                  )}
                </div>
              )}

              {tab === 'APPROVED' && isSuperAdmin && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setCommission({ id: a.id, rate: String(a.commissionRate) })}
                    className="btn-outline flex-1 justify-center text-sm"
                  >% 수수료 수정</button>
                </div>
              )}

              {tab === 'REJECTED' && a.rejectionReason && (
                <div className="mt-2 p-3 bg-red-50 rounded-lg text-xs text-red-600">
                  거절 사유: {a.rejectionReason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reject modal */}
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

      {/* Commission modal */}
      {commission && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-bold text-slate-800 text-lg mb-4">수수료율 수정</h3>
            <div className="flex items-center gap-2 mb-4">
              <input
                type="number" min="0" max="100" step="0.5"
                className="input" value={commission.rate}
                onChange={(e) => setCommission({ ...commission, rate: e.target.value })}
              />
              <span className="text-slate-500 font-bold">%</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCommission(null)} className="btn-outline flex-1 justify-center">취소</button>
              <button onClick={() => updateCommission(commission.id, commission.rate)} className="btn-primary flex-1 justify-center">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
