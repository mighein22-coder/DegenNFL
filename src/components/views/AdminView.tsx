import React, { useMemo, useState } from 'react';
import { AlertTriangle, Construction } from 'lucide-react';
import { Button } from '../Button';
import { activateWeek, type ActivationResult } from '../../lib/supabaseService';
import { formatETTime, getCurrentWeekNumber, getWeekOpensAt } from '../../lib/timezone';
import { WEEK_COUNT } from '../../constants';

/**
 * Admin panel.
 *
 * One control is real: opening a week by hand. It calls `activateWeek` in
 * lib/supabaseService.ts, which posts to `admin-activate-week` and runs exactly
 * the same `activateWeek` the Tuesday cron runs — one implementation, two
 * triggers. A second copy of the seeding-and-freezing logic would eventually
 * disagree with the scheduled one about what a week's lines are, and that is
 * the kind of disagreement that ends in a disputed payout.
 *
 * Safe to press twice. A line already frozen is never re-priced, so a second
 * run reports zero lines frozen and changes nothing.
 *
 * WHY THERE IS A WARNING ON EARLY ACTIVATION
 *
 * Activation is the ONLY moment the app writes a spread, and it never rewrites
 * one. So opening a week before its own Tuesday does not merely preview the
 * sheet — it freezes that week's numbers, permanently, at today's market. The
 * Tuesday cron will then find every line already set and leave them alone.
 * That is fine for a test week you intend to clear afterwards, and wrong for a
 * week the pool is going to be graded on, so the difference is stated on screen
 * rather than left in a doc.
 */

/** The remaining unbuilt admin jobs. Delete each line as it becomes a control. */
const STILL_NEEDED = [
  'Invites: createInvite() mints one reusable code for the whole pool, revokeInvite(code) shuts it, listInvites() / listInviteClaims() show what is open and who came in on it. All in lib/supabaseService.ts and admin-only in the database. Until this is built, one SQL statement covers the whole season — see docs/OPERATIONS.md.',
  "A list of that week's games with no spread, each with an input calling setSpread(gameId, rawSpread). Those games are unpickable until a line exists, and the deadline is EACH GAME'S OWN KICKOFF, not the Sunday sheet lock — pick_locked fires on start_time first, so a line set after kickoff lands on a game nobody can pick. Enter the RAW line from the home team's point of view — the database hooks it to a half point. There is no SQL fallback: admin_set_spread reads auth.uid(), which is null in the SQL editor, so this panel is the only place it can be done.",
  'Week status toggle (OPEN / LOCKED / COMPLETED). Note status does NOT control the deadline — final_lock_at is derived from the week id and cannot be moved from a client at all.',
  "Score corrections must go through a server function under the service-role key; the admin's own session cannot write those columns either."
];

export const AdminView: React.FC = () => {
  const [weekNumber, setWeekNumber] = useState<number>(() => getCurrentWeekNumber());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valid = Number.isInteger(weekNumber) && weekNumber >= 1 && weekNumber <= WEEK_COUNT;

  // Whether this week's own Tuesday has not arrived yet — see the header.
  const opensAt = useMemo(
    () => (valid ? getWeekOpensAt(weekNumber) : null),
    [valid, weekNumber]
  );
  const isEarly = opensAt != null && opensAt.getTime() > Date.now();

  const handleActivate = async () => {
    if (!valid) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await activateWeek(weekNumber));
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="font-display text-4xl tracking-wide text-ink">Admin Panel</h1>
        <p className="mt-2 text-muted">
          Open a week by hand, and set the lines the feed did not supply.
        </p>
      </header>

      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="font-display text-lg tracking-wide text-ink">Open a week</h2>
        <p className="mt-2 text-sm text-muted">
          Seeds the week&rsquo;s schedule from ESPN and freezes every line it can
          find. This is what the Tuesday 18:00&nbsp;ET cron does; press it when the
          cron did not run, or when a week needs re-seeding. Safe to press twice.
        </p>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted">Week</span>
            <input
              type="number"
              min={1}
              max={WEEK_COUNT}
              value={Number.isNaN(weekNumber) ? '' : weekNumber}
              onChange={e => setWeekNumber(Number(e.target.value))}
              className="w-24 rounded-control border border-line bg-surface-sunken px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </label>
          <Button onClick={handleActivate} isLoading={running} disabled={!valid}>
            Activate week
          </Button>
        </div>

        {!valid && (
          <p className="mt-3 text-sm text-loss">
            Week must be a whole number between 1 and {WEEK_COUNT}.
          </p>
        )}

        {valid && isEarly && opensAt && (
          <div className="mt-5 flex gap-3 rounded-card border border-line bg-surface-sunken p-4">
            <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
            <div className="text-sm">
              <p className="text-ink">
                Week {weekNumber} does not open until{' '}
                {formatETTime(opensAt, 'EEEE d MMMM, h:mm a zzz')}.
              </p>
              <p className="mt-1 text-muted">
                Activating now freezes its lines at today&rsquo;s market, and nothing
                re-prices them afterwards — the Tuesday job will find them already
                set and leave them alone. Fine for a test week you intend to clear;
                not what you want for a week the pool is graded on.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-card border border-loss bg-surface-sunken p-4 text-sm text-ink">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-5 rounded-card border border-line bg-surface-sunken p-4 text-sm">
            <p className="text-ink">
              <span className="font-mono">{result.weekId}</span> — {result.gamesSeeded}{' '}
              {result.gamesSeeded === 1 ? 'game' : 'games'} seeded, {result.linesFrozen}{' '}
              {result.linesFrozen === 1 ? 'line' : 'lines'} frozen.
            </p>

            {result.linesFrozen === 0 && result.gamesSeeded > 0 && (
              <p className="mt-1 text-faint">
                Zero lines frozen means they were already set by an earlier run.
                Nothing changed.
              </p>
            )}

            {result.gamesWithoutLine.length > 0 && (
              <p className="mt-2 text-muted">
                No line yet, and unpickable until one is set:{' '}
                <span className="text-ink">{result.gamesWithoutLine.join(', ')}</span>
              </p>
            )}

            {result.errors.length > 0 && (
              <ul className="mt-2 space-y-1 text-loss">
                {result.errors.map(message => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-card border border-line bg-surface p-6">
        <p className="mb-4 flex items-center gap-2 font-display text-lg tracking-wide text-brand-400">
          <Construction size={20} aria-hidden />
          Not built yet
        </p>
        <ul className="space-y-2 text-sm text-muted">
          {STILL_NEEDED.map(need => (
            <li key={need} className="flex gap-2">
              <span aria-hidden className="text-faint">
                &bull;
              </span>
              {need}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};
