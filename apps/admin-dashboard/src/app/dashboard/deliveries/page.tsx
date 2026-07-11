'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/auth';
import { makeFetcher, type DeliveryGroup, type PaginatedResult, type ReturnRequest } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('ko-KR') : '—';
const STATUS_OPTIONS = ['', 'PREPARING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURN_REQUESTED', 'RETURNED'];

type Tab = 'deliveries' | 'returns';

export default function DeliveriesPage() {
  const { token } = useAuth();
  const [tab, setTab]       = useState<Tab>('deliveries');
  const [page, setPage]     = useState(1);
  const [status, setStatus] = useState('');

  const deliveriesKey = `/api/v1/admin/deliveries?page=${page}&limit=20${status ? `&status=${status}` : ''}`;
  const returnsKey    = `/api/v1/admin/returns?page=${page}&limit=20`;

  const { data: deliveries, error: delivErr } = useSWR<PaginatedResult<DeliveryGroup> & { statusSummary: { status: string; count: string }[] }>(
    tab === 'deliveries' ? deliveriesKey : null,
    makeFetcher(token),
    { refreshInterval: 20000 },
  );

  const { data: returns, error: retErr } = useSWR<PaginatedResult<ReturnRequest>>(
    tab === 'returns' ? returnsKey : null,
    makeFetcher(token),
    { refreshInterval: 20000 },
  );

  const currentError = tab === 'deliveries' ? delivErr : retErr;

  const statusSummary = deliveries?.statusSummary ?? [];
  const preparingCount  = parseInt(statusSummary.find((s) => s.status === 'PREPARING')?.count ?? '0', 10);
  const returnCount     = parseInt(statusSummary.find((s) => s.status === 'RETURN_REQUESTED')?.count ?? '0', 10);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">배송 현황</h1>
          <p className="text-slate-500 text-sm mt-1">전체 배송 그룹 및 반품/환불 관리</p>
        </div>
        {/* Quick alerts */}
        <div className="flex gap-3">
          {preparingCount > 0 && (
            <div className="card px-4 py-2 border-l-4 border-amber-400 text-sm">
              <span className="text-amber-600 font-bold">{preparingCount}</span>
              <span className="text-slate-500 ml-1">건 준비중</span>
            </div>
          )}
          {returnCount > 0 && (
            <div className="card px-4 py-2 border-l-4 border-red-400 text-sm">
              <span className="text-red-600 font-bold">{returnCount}</span>
              <span className="text-slate-500 ml-1">건 반품 요청</span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['deliveries', 'returns'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'deliveries' ? `배송 그룹 (${deliveries?.total ?? 0})` : `반품/환불 (${returns?.total ?? 0})`}
          </button>
        ))}
      </div>

      {/* Status filter pills (deliveries only) */}
      {tab === 'deliveries' && (
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.filter(Boolean).map((s) => {
            const cnt = statusSummary.find((r) => r.status === s)?.count ?? '0';
            return (
              <button
                key={s}
                onClick={() => { setStatus(status === s ? '' : s); setPage(1); }}
                className={`text-xs px-3 py-1.5 rounded-full font-semibold border transition-colors ${
                  status === s
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'border-slate-200 text-slate-600 hover:border-blue-300'
                }`}
              >
                {s} ({cnt})
              </button>
            );
          })}
        </div>
      )}

      {currentError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{currentError.message}</div>
      )}

      {/* Deliveries table */}
      {tab === 'deliveries' && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">배송 그룹 ID</th>
                <th className="th">에이전트</th>
                <th className="th">상태</th>
                <th className="th">택배사</th>
                <th className="th">운송장번호</th>
                <th className="th">출고일</th>
                <th className="th">배송완료</th>
              </tr>
            </thead>
            <tbody>
              {(deliveries?.items ?? []).map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="td font-mono text-xs text-slate-400">{d.id.slice(0, 12)}…</td>
                  <td className="td text-slate-700">{d.agent_name ?? '—'}</td>
                  <td className="td"><StatusBadge value={d.status} /></td>
                  <td className="td text-slate-600">{d.courier_name ?? '—'}</td>
                  <td className="td font-mono text-xs">{d.tracking_number ?? '—'}</td>
                  <td className="td text-xs text-slate-400">{fmt(d.shipped_at)}</td>
                  <td className="td text-xs text-slate-400">{fmt(d.delivered_at)}</td>
                </tr>
              ))}
              {!(deliveries?.items?.length) && !delivErr && (
                <tr><td colSpan={7} className="td text-center text-slate-400 py-12">배송 데이터가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Returns table */}
      {tab === 'returns' && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">반품 ID</th>
                <th className="th">에이전트</th>
                <th className="th">상태</th>
                <th className="th">환불금액</th>
                <th className="th">사유</th>
                <th className="th">신청일</th>
              </tr>
            </thead>
            <tbody>
              {(returns?.items ?? []).map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="td font-mono text-xs text-slate-400">{r.id.slice(0, 12)}…</td>
                  <td className="td text-slate-700">{r.agent_name ?? '—'}</td>
                  <td className="td"><StatusBadge value={r.status} /></td>
                  <td className="td font-bold">{r.refund_amount ? `₩${r.refund_amount.toLocaleString('ko-KR')}` : '—'}</td>
                  <td className="td text-slate-600 max-w-xs truncate">{r.reason}</td>
                  <td className="td text-xs text-slate-400">{fmt(r.created_at)}</td>
                </tr>
              ))}
              {!(returns?.items?.length) && !retErr && (
                <tr><td colSpan={6} className="td text-center text-slate-400 py-12">반품 신청이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {(() => {
        const total = (tab === 'deliveries' ? deliveries?.totalPages : returns?.totalPages) ?? 1;
        return total > 1 ? (
          <div className="flex justify-center gap-2 flex-wrap">
            {Array.from({ length: total }, (_, i) => i + 1).map((p) => (
              <button
                key={p} onClick={() => setPage(p)}
                className={p === page ? 'btn-primary text-xs py-1.5 px-3' : 'btn-outline text-xs py-1.5 px-3'}
              >{p}</button>
            ))}
          </div>
        ) : null;
      })()}
    </div>
  );
}
