'use client';

import { useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, apiPatch, apiPost, type AdminOrder, type AgentProfile, type PaginatedResult } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const won = (n: number) => `₩${n.toLocaleString('ko-KR')}`;
const fmt = (d: string) => new Date(d).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

const STATUS_OPTIONS = ['', 'PENDING', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'PARTIALLY_SHIPPED', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED'];
const CHANGEABLE_STATUSES = ['PENDING','PAYMENT_PENDING','PAID','PROCESSING','PARTIALLY_SHIPPED','SHIPPED','COMPLETED','CANCELLED','REFUNDED'];

export default function OrdersPage() {
  const { token } = useAuth();
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [agentId, setAgentId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editOrder, setEditOrder] = useState<AdminOrder | null>(null);
  const [newStatus, setNewStatus] = useState('');
  const [refundOrder, setRefundOrder] = useState<AdminOrder | null>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundKey, setRefundKey] = useState('');
  const [refundPending, setRefundPending] = useState(false);
  const [toast, setToast]   = useState<{ msg: string; ok: boolean } | null>(null);

  const filters = `${status ? `&status=${status}` : ''}${agentId ? `&agentId=${agentId}` : ''}${dateFrom ? `&dateFrom=${dateFrom}` : ''}${dateTo ? `&dateTo=${dateTo}` : ''}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`;
  const key = `/api/v1/admin/orders?page=${page}&limit=20${filters}`;
  const { data, error } = useSWR<PaginatedResult<AdminOrder>>(key, makeFetcher(token), { refreshInterval: 20000 });
  const { data: agents } = useSWR<PaginatedResult<AgentProfile>>('/api/v1/agents?status=APPROVED&limit=100', makeFetcher(token));

  const rows = data?.items ?? [];

  const summary = data?.items?.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {}) ?? {};

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  async function changeStatus() {
    if (!editOrder || !newStatus) return;
    try {
      await apiPatch(`/api/v1/admin/orders/${editOrder.id}/status`, token, { status: newStatus });
      setEditOrder(null);
      setNewStatus('');
      globalMutate(key);
      showToast('주문 상태가 변경되었습니다.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '오류가 발생했습니다.', false);
    }
  }

  function openRefund(order: AdminOrder) {
    const remaining = (order.payment_amount ?? 0) - (order.refunded_amount ?? 0);
    setRefundOrder(order);
    setRefundAmount(String(remaining));
    setRefundReason('');
    setRefundKey(crypto.randomUUID());
  }

  async function issueRefund() {
    if (!refundOrder?.payment_id || refundPending) return;
    const amount = Number(refundAmount);
    const remaining = (refundOrder.payment_amount ?? 0) - (refundOrder.refunded_amount ?? 0);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
      return showToast(`환불 금액은 1원 이상 ${won(remaining)} 이하여야 합니다.`, false);
    }
    if (!refundReason.trim()) return showToast('환불 사유를 입력하세요.', false);

    setRefundPending(true);
    try {
      await apiPost(`/api/v1/admin/payments/${refundOrder.payment_id}/refund`, token, {
        refundAmount: amount,
        reason: refundReason.trim(),
        idempotencyKey: refundKey,
      });
      setRefundOrder(null);
      globalMutate(key);
      showToast('환불 요청이 처리되었습니다.');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : '환불 처리 중 오류가 발생했습니다.', false);
    } finally {
      setRefundPending(false);
    }
  }

  return (
    <div className="p-8 space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-semibold
          ${toast.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-slate-800">주문 관리</h1>
        <p className="text-slate-500 text-sm mt-1">전체 {data?.total ?? 0}건</p>
      </div>

      {/* Quick status filter pills */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.filter(Boolean).map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(status === s ? '' : s); setPage(1); }}
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
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select className="input w-52" value={agentId} onChange={(e) => { setAgentId(e.target.value); setPage(1); }}>
          <option value="">전체 에이전트</option>
          {(agents?.items ?? []).map((agent) => <option key={agent.id} value={agent.id}>{agent.businessName}</option>)}
        </select>
        <input className="input w-44" type="date" aria-label="시작일" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        <input className="input w-44" type="date" aria-label="종료일" min={dateFrom || undefined} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
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
              <th className="th">액션</th>
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
                <td className="td">
                  <div className="flex gap-1 flex-wrap">
                    <button
                      onClick={() => { setEditOrder(o); setNewStatus(o.status); }}
                      className="btn-ghost text-xs py-1 px-2"
                    >
                      상태 변경
                    </button>
                    {o.payment_id && ['COMPLETED', 'PARTIALLY_REFUNDED'].includes(o.payment_status ?? '') &&
                      (o.payment_amount ?? 0) > (o.refunded_amount ?? 0) && (
                      <button onClick={() => openRefund(o)} className="btn-ghost text-xs py-1 px-2 text-red-600">
                        환불
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td colSpan={6} className="td text-center text-slate-400 py-12">주문이 없습니다.</td></tr>
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

      {/* Status change modal */}
      {editOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="font-bold text-slate-800 text-lg mb-1">주문 상태 변경</h3>
            <p className="text-xs text-slate-500 mb-4 font-mono">{editOrder.id.slice(0, 20)}…</p>

            <div className="mb-2">
              <p className="text-xs text-slate-500 mb-1">현재 상태</p>
              <StatusBadge value={editOrder.status} />
            </div>

            <div className="mt-4 mb-4">
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">변경할 상태</label>
              <select
                className="input"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
              >
                {CHANGEABLE_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setEditOrder(null)} className="btn-outline flex-1 justify-center">취소</button>
              <button
                onClick={changeStatus}
                disabled={newStatus === editOrder.status}
                className="btn-primary flex-1 justify-center"
              >
                변경 확정
              </button>
            </div>
          </div>
        </div>
      )}

      {refundOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="font-bold text-slate-800 text-lg mb-1">결제 환불</h3>
            <p className="text-xs text-slate-500 mb-4 font-mono">주문 {refundOrder.id.slice(0, 20)}…</p>
            <p className="text-sm text-slate-600 mb-4">
              결제 {won(refundOrder.payment_amount ?? 0)} · 기환불 {won(refundOrder.refunded_amount ?? 0)}
            </p>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">환불 금액</label>
            <input className="input mb-4" type="number" min="1"
              max={(refundOrder.payment_amount ?? 0) - (refundOrder.refunded_amount ?? 0)}
              value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} />
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">환불 사유</label>
            <textarea className="input mb-5" rows={3} maxLength={500} value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)} placeholder="고객에게 기록될 환불 사유" />
            <div className="flex gap-2">
              <button onClick={() => setRefundOrder(null)} disabled={refundPending} className="btn-outline flex-1 justify-center">취소</button>
              <button onClick={issueRefund} disabled={refundPending} className="btn-primary flex-1 justify-center bg-red-500 hover:bg-red-600">
                {refundPending ? '처리 중…' : '환불 실행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
