import React, { useState } from 'react';
import { Button } from '../Button';
import { supabase } from '../../lib/supabase';

interface LoginViewProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignUp: (
    email: string,
    password: string,
    name: string,
    inviteCode: string
  ) => Promise<{ needsConfirmation: boolean }>;
}

/**
 * The way in: sign in, sign up with an invite code, or reset a password.
 *
 * Signup is gated. An invite code is required, and it is the database that
 * enforces it — `redeem_invite` is the only thing that can create a profile,
 * and a profile is what membership actually is. See 0003_invites.sql. Nothing
 * here is load-bearing for that; this screen just collects the code.
 */
export const LoginView: React.FC<LoginViewProps> = ({ onLogin, onSignUp }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login');
  const [resetMessage, setResetMessage] = useState('');
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [signupMessage, setSignupMessage] = useState('');

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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSignupMessage('');
    setLoading(true);

    try {
      const { needsConfirmation } = await onSignUp(email, password, name, inviteCode);

      if (needsConfirmation) {
        // The project requires email confirmation, so there is no session yet
        // and the invite cannot be redeemed until they come back signed in.
        // The app asks for the code again at that point, so nothing is lost.
        setSignupMessage(
          'Check your email to confirm your address, then sign in — we will ask for your invite code once more.'
        );
        setPassword('');
      }
    } catch (err: any) {
      setError(err.message || 'Could not create your account.');
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
            DEGEN NFL
          </h1>
          <p className="text-muted uppercase tracking-widest text-sm">
            NFL Against the Spread
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
                <div>
                  Got an invite code?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signup');
                      setError('');
                      setPassword('');
                    }}
                    className="text-brand-400 hover:text-brand-300 underline"
                  >
                    Create your account
                  </button>
                </div>
                <div>No code? Ask the pool admin for one.</div>
              </div>
            </form>
          ) : mode === 'signup' ? (
            <form onSubmit={handleSignUp} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Invite Code
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="ABCD-EFGH-IJKL"
                  required
                  autoComplete="off"
                  className="w-full bg-surface-sunken/60 border border-line rounded-card px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none placeholder:text-faint"
                />
                <p className="mt-1 text-xs text-faint">
                  Case, spaces and dashes do not matter.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="How you appear in the standings"
                  required
                  className="w-full bg-surface-sunken/60 border border-line rounded-card px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none placeholder:text-faint"
                />
              </div>

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
                  minLength={8}
                  className="w-full bg-surface-sunken/60 border border-line rounded-card px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none placeholder:text-faint"
                />
              </div>

              {error && (
                <p className="text-loss text-sm bg-loss/15 border border-loss/50 rounded px-3 py-2">
                  {error}
                </p>
              )}

              {signupMessage && (
                <p className="text-win text-sm bg-win/15 border border-win/50 rounded px-3 py-2">
                  {signupMessage}
                </p>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? 'Creating account...' : 'Join the Pool'}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError('');
                    setSignupMessage('');
                  }}
                  className="text-brand-400 hover:text-brand-300 underline text-xs"
                >
                  Back to login
                </button>
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
