'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const COLORS: Record<string, string> = {
  APPROVED: '#10b981',
  PENDING:  '#f59e0b',
  REJECTED: '#ef4444',
};

interface Item { approval_status: string; count: string | number }

export default function AgentStatusChart({ data }: { data: Item[] }) {
  if (!data.length) {
    return (
      <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
        에이전트 데이터가 없습니다.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.approval_status,
    value: Number(d.count),
    color: COLORS[d.approval_status] ?? '#94a3b8',
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(v: number) => [`${v}개`, '에이전트']}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: 12 }}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
