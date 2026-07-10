'use client';

import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const COLORS: Record<string, string> = {
  COMPLETED:       '#10b981',
  PAID:            '#3b82f6',
  CONFIRMED:       '#6366f1',
  PENDING:         '#f59e0b',
  PAYMENT_PENDING: '#f97316',
  CANCELLED:       '#ef4444',
  REFUNDED:        '#a855f7',
  SHIPPED:         '#14b8a6',
};
const DEFAULT_COLOR = '#94a3b8';

interface Item { status: string; count: string | number }

export default function OrderStatusChart({ data }: { data: Item[] }) {
  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
        주문 데이터가 없습니다.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.status,
    value: Number(d.count),
    color: COLORS[d.status] ?? DEFAULT_COLOR,
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%" cy="50%"
          innerRadius={60} outerRadius={90}
          paddingAngle={3}
          dataKey="value"
        >
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number) => [`${v}건`, '']}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: 12 }}
        />
        <Legend
          formatter={(v) => <span style={{ fontSize: 12, color: '#475569' }}>{v}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
