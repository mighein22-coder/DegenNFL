import React, { useState } from 'react';
import { Button } from '../Button';
import { supabase } from '../../lib/supabase';

interface LoginViewProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

/**
 * Login view - Authentication screen with password reset
 */
export const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [resetMessage, setResetMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await onLogin(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResetMessage('');
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`
      });

      if (error) throw error;

      setResetMessage('Check your email for a password reset link.');
      setEmail('');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-canvas">
        <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-600/20 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/20 blur-[120px] rounded-full"></div>
      </div>

      {/* Login Card */}
      <div className="relative z-10 w-full max-w-md p-8">
        <div className="text-center mb-10">
          <h1 className="font-display text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-brand-200 mb-2">
            ICEPICK
          </h1>
          <p className="text-muted uppercase tracking-widest text-sm">
            Official NHL Pick'em League
          </p>
        </div>

        <div className="bg-surface/60 backdrop-blur-xl border border-white/10 p-8 rounded-2xl shadow-2xl">
          {mode === 'login' ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full bg-surface-sunken/60 border border-line rounded-card px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none placeholder:text-faint"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-surface-sunken/60 border border-line rounded-card px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none placeholder:text-faint"
                />
              </div>

              {error && (
                <p className="text-loss text-sm bg-loss/15 border border-loss/50 rounded px-3 py-2">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? 'Signing in...' : 'Enter League'}
              </Button>

              <div className="text-center space-y-2 text-xs text-muted">
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      setError('');
                      setPassword('');
                    }}
                    className="text-brand-400 hover:text-brand-300 underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div>Need access? Contact the pool admin.</div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full bg-surface-sunken/60 border border-line rounded-card px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none placeholder:text-faint"
                />
              </div>

              {error && (
                <p className="text-loss text-sm bg-loss/15 border border-loss/50 rounded px-3 py-2">
                  {error}
                </p>
              )}

              {resetMessage && (
                <p className="text-win text-sm bg-win/15 border border-win/50 rounded px-3 py-2">
                  {resetMessage}
                </p>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Email'}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                    setResetMessage('');
                    setEmail('');
                  }}
                  className="text-brand-400 hover:text-brand-300 underline text-xs"
                >
                  Back to login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
