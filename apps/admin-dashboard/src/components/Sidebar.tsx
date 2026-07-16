'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const NAV_COMMON = [
  { href: '/dashboard',             icon: '▦',  label: '대시보드' },
  { href: '/dashboard/users',       icon: '👥', label: '사용자 관리' },
  { href: '/dashboard/agents',      icon: '🏪', label: '에이전트 관리' },
  { href: '/dashboard/products',    icon: '📦', label: '상품 승인' },
  { href: '/dashboard/orders',      icon: '🛒', label: '주문 관리' },
  { href: '/dashboard/deliveries',  icon: '🚚', label: '배송 현황' },
  { href: '/dashboard/ads',         icon: '📣', label: '광고 관리' },
  { href: '/dashboard/analytics',   icon: '📊', label: '통계 분석' },
];

const NAV_SUPER_ADMIN = [
  { href: '/dashboard/audit',       icon: '📋', label: '감사 로그' },
  { href: '/dashboard/settlements', icon: '💳', label: '정산 관리' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const isSuperAdmin = user?.role === 'super-admin';

  const nav = isSuperAdmin ? [...NAV_COMMON, ...NAV_SUPER_ADMIN] : NAV_COMMON;

  return (
    <aside className="w-64 min-h-screen bg-sidebar flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <div className="text-white font-bold text-lg tracking-tight">🛒 eCommerce</div>
        <div className="text-slate-400 text-xs mt-0.5">Admin Dashboard</div>
      </div>

      {/* Role badge */}
      <div className="px-4 pt-3 pb-1">
        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${
          isSuperAdmin
            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
            : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
        }`}>
          {isSuperAdmin ? '⭐ SUPER ADMIN' : '🔧 ADMIN'}
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 space-y-0.5">
        {nav.map(({ href, icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${active
                  ? 'bg-blue-500 text-white'
                  : 'text-slate-400 hover:bg-sidebar-hover hover:text-white'}`}
            >
              <span className="text-base">{icon}</span>
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${
            isSuperAdmin ? 'bg-purple-500' : 'bg-blue-500'
          }`}>
            {user?.firstName?.[0] ?? 'A'}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
            <p className="text-slate-400 text-xs truncate">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full text-left px-3 py-2 rounded-lg text-slate-400 hover:bg-sidebar-hover hover:text-white text-sm transition-colors"
        >
          ⎋ 로그아웃
        </button>
      </div>
    </aside>
  );
}
