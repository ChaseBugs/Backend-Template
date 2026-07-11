'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import type { UserRegistrationTrend } from '@/lib/api';

export default function UserTrendChart({ data }: { data: UserRegistrationTrend[] }) {
  if (!data.length) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
        아직 가입 데이터가 없습니다.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickFormatter={(v) => v.slice(5)}
          axisLine={false} tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          axisLine={false} tickLine={false} width={30}
        />
        <Tooltip
          formatter={(v: number) => [v, '신규 가입']}
          labelFormatter={(l) => `날짜: ${l}`}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: 12 }}
        />
        <Area
          type="monotone" dataKey="count"
          stroke="#10b981" strokeWidth={2}
          fill="url(#userGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
