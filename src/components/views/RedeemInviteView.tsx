import React, { useState } from 'react';
import { Button } from '../Button';

interface RedeemInviteViewProps {
  email: string;
  /** A redemption that already failed during signup, so it is not lost. */
  initialError?: string | null;
  onRedeem: (inviteCode: string, name: string) => Promise<void>;
  onSignOut: () => void;
}

/**
 * "You are signed in, but you are not a member yet."
 *
 * Reached by anyone holding a session with no profile row. That is not an error
 * state and not an attack — it is the normal middle of signing up:
 *
 *   * The project requires email confirmation, so `auth.signUp` returned no
 *     session and the invite could not be redeemed at the time. They confirmed,
 *     signed in, and arrive here.
 *   * Or they mistyped the code during signup. Without this screen the account
 *     would be stranded: auth user created, no profile, no way to make one.
 *
 * It is also what an uninvited stranger sees, forever, if they sign up without
 * a code — this screen is the whole of the app as far as they are concerned.
 *
 * That is only true because 0003 also tightened the policies around it. The
 * foreign key on `picks.user_id` stops them PICKING, but on its own it left
 * them able to read the whole member roster and to insert rows into `weeks`
 * and `games` — including squatting a real fixture so the Tuesday rollover
 * graded it against an inverted line. Being unable to pick was never the same
 * as being unable to act.
 */
export const RedeemInviteView: React.FC<RedeemInviteViewProps> = ({
  email,
  initialError,
  onRedeem,
  onSignOut
}) => {
  const [inviteCode, setInviteCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(initialError ?? '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onRedeem(inviteCode, name);
      // On success the profile lands and the app shell replaces this screen;
      // there is nothing to navigate to.
    } catch (err: any) {
      // redeem_invite raises messages written to be read ("that invite has
      // already been used"). Drop the function-name prefix, keep the sentence.
      const raw = err?.message ?? String(err);
      // Two tabs redeeming at once lose the race inside Postgres rather than
      // in our pre-check, and surface as a primary-key violation. The outcome
      // is right — no second profile, no code burned — but the message is not
      // something to show anyone.
      setError(
        /duplicate key|profiles_pkey/i.test(raw)
          ? 'You are already a member — try reloading the page.'
          : raw.replace(/^redeem_invite:\s*/, '')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-canvas">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-600/20 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="font-display text-4xl tracking-wide text-ink mb-2">
            One more step
          </h1>
          <p className="text-muted text-sm">
            You&rsquo;re signed in as <span className="text-ink">{email}</span>, but you
            need an invite to join the pool.
          </p>
        </div>

        <div className="bg-surface/60 backdrop-blur-xl border border-white/10 p-8 rounded-2xl shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-muted mb-2">
                Invite Code
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
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
                onChange={e => setName(e.target.value)}
                placeholder="How you appear in the standings"
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
              {loading ? 'Checking...' : 'Join the Pool'}
            </Button>

            <div className="text-center text-xs text-muted">
              <div>No code? Ask the pool admin for one.</div>
              <button
                type="button"
                onClick={onSignOut}
                className="mt-2 text-brand-400 hover:text-brand-300 underline"
              >
                Sign out
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
