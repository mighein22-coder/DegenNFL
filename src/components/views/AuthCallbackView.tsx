import React, { useEffect, useState } from 'react';
import { initialAuthParams } from '../../lib/authRedirect';
import { supabase } from '../../lib/supabase';
import { Button } from '../Button';

type Phase =
  | { kind: 'working' }
  | { kind: 'set-password' }
  | { kind: 'confirmed' }
  | { kind: 'error'; message: string };

/**
 * Landing route for every emailed auth link.
 *
 * `LoginView` sends password resets to `${origin}/auth/callback`, which until
 * now did not exist — the SPA fallback served the login screen, so reset links
 * dead-ended and there was no way to choose a new password.
 *
 * Supabase delivers the session in one of two shapes depending on the project's
 * configured flow, and this handles both:
 *
 *   implicit (the default) — `#access_token=...&type=recovery` in the fragment,
 *     which supabase-js consumes automatically on load because
 *     `detectSessionInUrl` is on, firing a PASSWORD_RECOVERY auth event.
 *   PKCE — `?code=...` in the query, which must be exchanged explicitly.
 *
 * It also has to render even when a session already exists: during recovery one
 * does, and the authed shell would otherwise redirect straight to the dashboard
 * before the user could set a password.
 */
export interface AuthCallbackViewProps {
  /**
   * Leave the callback screen. The caller strips the auth parameters out of
   * the URL; where the user lands is then decided by the normal auth gate —
   * a valid session lands in the pool, no session falls through to login.
   */
  onDone: () => void;
}

export const AuthCallbackView: React.FC<AuthCallbackViewProps> = ({ onDone }) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'working' });

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let cancelled = false;

    // Read from the load-time snapshot, not from the live URL: supabase-js has
    // already stripped the fragment by the time this runs.
    const { type: linkType, errorDescription, code } = initialAuthParams;

    if (errorDescription) {
      setPhase({ kind: 'error', message: errorDescription });
      return;
    }

    const run = async () => {
      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        // In the implicit flow supabase-js consumes the fragment during module
        // init, which may land just after this effect runs — so poll briefly
        // rather than reading the session once and giving up.
        let session = (await supabase.auth.getSession()).data.session;
        for (let attempt = 0; attempt < 20 && !session && !cancelled; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          session = (await supabase.auth.getSession()).data.session;
        }
        if (cancelled) return;

        if (!session) {
          setPhase({
            kind: 'error',
            message: 'This link is invalid or has already been used.'
          });
          return;
        }

        setPhase(linkType === 'signup' ? { kind: 'confirmed' } : { kind: 'set-password' });
      } catch (err: any) {
        if (!cancelled) {
          setPhase({ kind: 'error', message: err.message || 'Could not verify this link.' });
        }
      }
    };

    run();

    // A PASSWORD_RECOVERY event can arrive after the poll above starts
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !cancelled) {
        setPhase({ kind: 'set-password' });
      }
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (password.length < 8) {
      setFormError('Use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('The two passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      onDone();
    } catch (err: any) {
      setFormError(err.message || 'Could not update your password.');
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-canvas">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-600/20 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/20 blur-[120px] rounded-full" />

      <div className="relative z-10 w-full max-w-md p-8">
        <div className="text-center mb-10">
          <h1 className="font-display text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-brand-200 mb-2">
            ICEPICK
          </h1>
        </div>

        <div className="bg-surface/60 backdrop-blur-xl border border-white/10 p-8 rounded-2xl shadow-2xl">
          {phase.kind === 'working' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="w-8 h-8 border-4 border-brand-500/20 border-t-ice-500 rounded-full animate-spin" />
              <p className="text-muted text-sm">Verifying your link…</p>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-white font-bold text-lg mb-2">Link no longer valid</h2>
                <p className="text-muted text-sm">{phase.message}</p>
                <p className="text-muted text-xs mt-2">
                  Reset links can only be used once, and expire after a while.
                </p>
              </div>
              <Button className="w-full" size="lg" onClick={onDone}>
                Request a new link
              </Button>
            </div>
          )}

          {phase.kind === 'confirmed' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-white font-bold text-lg mb-2">Email confirmed</h2>
                <p className="text-muted text-sm">Your account is ready.</p>
              </div>
              <Button className="w-full" size="lg" onClick={onDone}>
                Continue to the pool
              </Button>
            </div>
          )}

          {phase.kind === 'set-password' && (
            <form onSubmit={handleSetPassword} className="space-y-6">
              <div>
                <h2 className="text-white font-bold text-lg mb-1">Choose a new password</h2>
                <p className="text-muted text-xs">At least 8 characters.</p>
              </div>

              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-muted mb-2">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="w-full bg-surface-sunken/60 border border-line rounded-card px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none placeholder:text-faint"
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-muted mb-2">
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="w-full bg-surface-sunken/60 border border-line rounded-card px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none placeholder:text-faint"
                />
              </div>

              {formError && (
                <p className="text-loss text-sm bg-loss/15 border border-loss/50 rounded px-3 py-2">
                  {formError}
                </p>
              )}

              <Button type="submit" className="w-full" size="lg" disabled={saving}>
                {saving ? 'Saving…' : 'Set password and sign in'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
