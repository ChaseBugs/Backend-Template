'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const [email, setEmail]     = useState('admin@demo.com');
  const [password, setPass]   = useState('Admin1234!');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🛒</div>
          <h1 className="text-2xl font-bold text-white">eCommerce Admin</h1>
          <p className="text-slate-400 text-sm mt-1">관리자 로그인</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">이메일</label>
              <input
                type="email" className="input" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@demo.com"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">비밀번호</label>
              <input
                type="password" className="input" required
                value={password} onChange={(e) => setPass(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="btn-primary w-full justify-center py-2.5 text-base"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-3">데모 계정</p>
            <div className="space-y-1 text-xs text-slate-500">
              <div className="flex justify-between"><span>Admin</span><span className="font-mono">admin@demo.com / Admin1234!</span></div>
              <div className="flex justify-between"><span>Super Admin</span><span className="font-mono">superadmin@demo.com / SuperAdmin1!</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
