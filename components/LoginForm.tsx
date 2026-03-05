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
    <form onSubmit={handleSubmit} className="bg-slate-900 rounded-lg border border-slate-800 p-5 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <LockKeyhole size={18} /> Admin Login
        </h3>
        <p className="text-sm text-slate-400 mt-1">Enter the server password to manage schedules and runs.</p>
      </div>

      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Admin password"
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
      />

      {error && <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/30 rounded-md p-3">{error}</div>}

      <button
        type="submit"
        disabled={!password.trim() || isLoading}
        className={`w-full px-4 py-3 rounded-lg font-semibold transition-colors ${
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
