import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Check, Construction, Lock } from 'lucide-react';
import { Button } from '../Button';
import {
  activateWeek,
  getGamesForWeek,
  setSpread,
  type ActivationResult
} from '../../lib/supabaseService';
import {
  describeHookedSpread,
  findGamesWithoutLine,
  parseSpreadInput,
  type MissingLineRow
} from '../../lib/missingLines';
import { useLoader } from '../../hooks/useLoader';
import { useNow } from '../../hooks/useNow';
import { buildWeekId, formatETTime, getCurrentWeekNumber, getWeekOpensAt } from '../../lib/timezone';
import { WEEK_COUNT } from '../../constants';

/**
 * Admin panel.
 *
 * Two controls, both real, both scoped to the week chosen at the top.
 *
 * OPENING A WEEK BY HAND calls `activateWeek` in lib/supabaseService.ts, which
 * posts to `admin-activate-week` and runs exactly the same `activateWeek` the
 * Tuesday cron runs — one implementation, two triggers. A second copy of the
 * seeding-and-freezing logic would eventually disagree with the scheduled one
 * about what a week's lines are, and that is the kind of disagreement that ends
 * in a disputed payout. Safe to press twice: a line already frozen is never
 * re-priced, so a second run reports zero lines frozen and changes nothing.
 *
 * SETTING A MISSING LINE calls `admin_set_spread`, and this panel is the ONLY
 * place it can be done. The function gates on `auth.uid()`, which is null in the
 * SQL editor — a superuser session has nobody logged in — so it refuses there
 * with `admin_set_spread: admins only`. Invites have a raw-insert escape hatch
 * because `invites` is an ordinary table; spreads do not, because `games.spread`
 * is not client-writable by any grant. That makes this section load-bearing
 * rather than a convenience, which is why it is here rather than in a doc.
 *
 * WHY THERE IS A WARNING ON EARLY ACTIVATION
 *
 * Activation is the ONLY moment the app writes a spread from the feed, and it
 * never rewrites one. So opening a week before its own Tuesday does not merely
 * preview the sheet — it freezes that week's numbers, permanently, at today's
 * market. The Tuesday cron will then find every line already set and leave them
 * alone. That is fine for a test week you intend to clear afterwards, and wrong
 * for a week the pool is going to be graded on, so the difference is stated on
 * screen rather than left in a doc.
 */

/** The remaining unbuilt admin jobs. Delete each line as it becomes a control. */
const STILL_NEEDED = [
  'Invites: createInvite() mints one reusable code for the whole pool, revokeInvite(code) shuts it, listInvites() / listInviteClaims() show what is open and who came in on it. All in lib/supabaseService.ts and admin-only in the database. Until this is built, one SQL statement covers the whole season — see docs/OPERATIONS.md.',
  'Week status toggle (OPEN / LOCKED / COMPLETED). Note status does NOT control the deadline — final_lock_at is derived from the week id and cannot be moved from a client at all.',
  "Score corrections must go through a server function under the service-role key; the admin's own session cannot write those columns either."
];

// ---------------------------------------------------------------------------
// One game waiting on a line
// ---------------------------------------------------------------------------

interface MissingLineFormProps {
  row: MissingLineRow;
  busy: boolean;
  onSet: (gameId: string, rawSpread: number) => Promise<void>;
}

/**
 * The input for one game.
 *
 * It shows what would be STORED before the button is pressed, naming both
 * teams: type -3 and the pool plays TB -3.5, MIN +3.5. Two mistakes are worth
 * that line of text — the hook itself, which surprises anyone who has not read
 * the rules, and the sign, which inverts the game silently and is the reason
 * the spike checked all fourteen away-favoured games. Neither is recoverable:
 * `admin_set_spread` refuses to move a line once it is frozen.
 */
const MissingLineForm: React.FC<MissingLineFormProps> = ({ row, busy, onSet }) => {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseSpreadInput(text), [text]);
  // An empty box is not yet a mistake, so it says nothing until something is typed.
  const inputProblem = text.trim() !== '' && !parsed.ok ? parsed.message : null;

  const handleSet = async () => {
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    try {
      await onSet(row.game.id, parsed.raw);
    } catch (err: any) {
      // admin_set_spread raises sentences meant to be read ('no such game, or
      // its line is already frozen'). Drop the function-name prefix, keep them.
      const raw = err?.message ?? String(err);
      setError(raw.replace(/^admin_set_spread:\s*/, ''));
    }
  };

  return (
    <li className="rounded-card border border-line bg-surface-sunken p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-display text-lg tracking-wide text-ink">{row.matchup}</p>
        <p className="text-sm">
          {row.locked ? (
            <span className="inline-flex items-center gap-1.5 text-loss">
              <Lock size={14} aria-hidden />
              Locked {formatETTime(row.deadline, 'EEE d MMM, h:mm a zzz')}
            </span>
          ) : (
            <span className="text-muted">
              Set by{' '}
              <span className="text-ink">
                {formatETTime(row.deadline, 'EEE d MMM, h:mm a zzz')}
              </span>{' '}
              — {row.timeRemaining} left
            </span>
          )}
        </p>
      </div>

      <p className="mt-1 text-sm text-faint">
        {row.deadlineReason === 'KICKOFF'
          ? 'Its own kickoff, which is what closes this one.'
          : `The Sunday sheet lock closes this one first — it does not kick off until ${formatETTime(row.kickoff, 'EEE h:mm a zzz')}.`}
      </p>

      {row.locked ? (
        <p className="mt-3 text-sm text-muted">
          Too late to be worth setting. Picking closed at the deadline above, and
          because the game was never pickable nobody holds a pick on it — a line
          added now would change nothing. Leave it; the week can still be scored
          around it.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted">
                Line, from {row.game.homeTeamId}&rsquo;s point of view
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={text}
                placeholder="-3"
                aria-label={`Line for ${row.matchup}, from ${row.game.homeTeamId}'s point of view`}
                onChange={e => {
                  setText(e.target.value);
                  setError(null);
                }}
                className="w-28 rounded-control border border-line bg-surface px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </label>
            <Button size="sm" onClick={handleSet} isLoading={busy} disabled={!parsed.ok}>
              Set line
            </Button>
          </div>

          {parsed.ok && (
            <p className="mt-2 text-sm text-muted">
              Stored as{' '}
              <span className="font-mono text-ink">{parsed.hooked}</span> —{' '}
              <span className="text-ink">
                {describeHookedSpread(
                  parsed.hooked,
                  row.game.homeTeamId,
                  row.game.awayTeamId
                )}
              </span>
              . Frozen the moment it is set, and never moved again.
            </p>
          )}

          {(inputProblem || error) && (
            <p className="mt-2 text-sm text-loss">{inputProblem ?? error}</p>
          )}
        </>
      )}
    </li>
  );
};

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export const AdminView: React.FC = () => {
  const [weekNumber, setWeekNumber] = useState<number>(() => getCurrentWeekNumber());
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingGameId, setSettingGameId] = useState<string | null>(null);

  const valid = Number.isInteger(weekNumber) && weekNumber >= 1 && weekNumber <= WEEK_COUNT;

  // Ticks, so a deadline left open on screen counts down and a row that passes
  // its deadline flips to locked without a reload.
  const now = useNow();

  // Whether this week's own Tuesday has not arrived yet — see the header.
  const opensAt = useMemo(
    () => (valid ? getWeekOpensAt(weekNumber) : null),
    [valid, weekNumber]
  );
  const isEarly = opensAt != null && opensAt.getTime() > Date.now();

  const loadGames = useCallback(
    () => (valid ? getGamesForWeek(buildWeekId(weekNumber)) : Promise.resolve([])),
    [valid, weekNumber]
  );
  const games = useLoader(loadGames);
  // Stable across renders (useLoader memoises it), unlike `games` itself —
  // which is a fresh object each render and would make every callback that
  // closes over it unstable.
  const reloadGames = games.reload;

  const missing = useMemo(
    () => (games.data && valid ? findGamesWithoutLine(games.data, weekNumber, now) : []),
    [games.data, valid, weekNumber, now]
  );

  const handleActivate = async () => {
    if (!valid) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      setResult(await activateWeek(weekNumber));
      // The seeding just changed which games need a line. Re-read rather than
      // reason about it from the activation result, which reports matchups
      // rather than ids.
      reloadGames();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleSetSpread = useCallback(
    async (gameId: string, rawSpread: number) => {
      setSettingGameId(gameId);
      try {
        await setSpread(gameId, rawSpread);
        // Re-read rather than patch the row locally: the database hooks the
        // number, and this list should show what it actually stored.
        reloadGames();
      } finally {
        setSettingGameId(null);
      }
    },
    [reloadGames]
  );

  return (
    <section className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="font-display text-4xl tracking-wide text-ink">Admin Panel</h1>
        <p className="mt-2 text-muted">
          Open a week by hand, and set the lines the feed did not supply.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-6">
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
        <p className="flex-1 pb-2.5 text-sm text-muted">
          Both controls below act on this week.
        </p>
        {!valid && (
          <p className="w-full text-sm text-loss">
            Week must be a whole number between 1 and {WEEK_COUNT}.
          </p>
        )}
      </div>

      <div className="rounded-card border border-line bg-surface p-6">
        <h2 className="font-display text-lg tracking-wide text-ink">Open a week</h2>
        <p className="mt-2 text-sm text-muted">
          Seeds the week&rsquo;s schedule from ESPN and freezes every line it can
          find. This is what the Tuesday 18:00&nbsp;ET cron does; press it when the
          cron did not run, or when a week needs re-seeding. Safe to press twice.
        </p>

        <div className="mt-5">
          <Button onClick={handleActivate} isLoading={running} disabled={!valid}>
            Activate week {valid ? weekNumber : ''}
          </Button>
        </div>

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
                {' — '}set them below.
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
        <h2 className="font-display text-lg tracking-wide text-ink">
          Games with no line
        </h2>
        <p className="mt-2 text-sm text-muted">
          The book had these OFF when the week was activated, so they were seeded
          without a number and <span className="text-ink">cannot be picked</span>{' '}
          until one is set. Each deadline below is that game&rsquo;s own — the
          earlier of its kickoff and the Sunday 13:00&nbsp;ET sheet lock, not
          Sunday for everything. There is no SQL fallback:{' '}
          <span className="font-mono text-faint">admin_set_spread</span> reads{' '}
          <span className="font-mono text-faint">auth.uid()</span>, which is null
          in the SQL editor, so this is the only place it can be done.
        </p>

        {games.error && (
          <div className="mt-5 rounded-card border border-loss bg-surface-sunken p-4 text-sm">
            <p className="text-ink">Could not load week {weekNumber}.</p>
            <p className="mt-1 font-mono text-faint">{games.error}</p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={games.reload}>
              Try again
            </Button>
          </div>
        )}

        {!games.error && games.loading && !games.data && (
          <p className="mt-5 text-sm text-muted">Loading week {weekNumber}…</p>
        )}

        {!games.error && games.data && games.data.length === 0 && (
          <p className="mt-5 text-sm text-muted">
            Week {weekNumber} has no games yet — it has not been opened. Activate
            it above, then anything the feed had no line for appears here.
          </p>
        )}

        {!games.error && games.data && games.data.length > 0 && missing.length === 0 && (
          <p className="mt-5 flex items-center gap-2 text-sm text-win">
            <Check size={16} aria-hidden />
            Every one of week {weekNumber}&rsquo;s {games.data.length} games has a
            line. Nothing to do.
          </p>
        )}

        {missing.length > 0 && (
          <ul className="mt-5 space-y-3">
            {missing.map(row => (
              <MissingLineForm
                key={row.game.id}
                row={row}
                busy={settingGameId === row.game.id}
                onSet={handleSetSpread}
              />
            ))}
          </ul>
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
