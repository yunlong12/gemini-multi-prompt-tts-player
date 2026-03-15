import React, { useState } from 'react';
import { LockKeyhole } from 'lucide-react';

interface LoginFormProps {
  onLogin: (password: string) => Promise<void>;
  isLoading: boolean;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onLogin, isLoading }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      await onLogin(password);
      setPassword('');
    } catch (loginError: any) {
      setError(loginError?.message || 'Login failed');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="overflow-hidden rounded-[1.5rem] border border-slate-800 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.14),_transparent_26%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.94))] p-5 shadow-[0_24px_70px_-38px_rgba(15,23,42,1)] space-y-4">
      <div>
        <div className="inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
          Secure Access
        </div>
        <h3 className="mt-3 text-lg font-semibold text-white flex items-center gap-2">
          <LockKeyhole size={18} /> Admin Login
        </h3>
        <p className="text-sm text-slate-400 mt-1">Enter the server password to manage schedules and runs.</p>
      </div>

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Admin password"
        className="w-full bg-slate-950/80 border border-slate-700 rounded-2xl px-4 py-3 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
      />

      {error && <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/30 rounded-md p-3">{error}</div>}

      <button
        type="submit"
        disabled={!password.trim() || isLoading}
        className={`min-h-[50px] w-full rounded-2xl px-4 py-3 font-semibold transition-colors ${
          !password.trim() || isLoading
            ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-500 text-white'
        }`}
      >
        {isLoading ? 'Signing In...' : 'Sign In'}
      </button>
    </form>
  );
};
