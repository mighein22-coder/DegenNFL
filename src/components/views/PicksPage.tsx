import React, { useCallback, useEffect, useState } from 'react';
import { PicksView } from './PicksView';
import { Button } from '../Button';
import {
  getCurrentWeek,
  getGamesForWeek,
  getPicksForWeek,
  savePicks,
  syncWeek,
  type PickSubmission
} from '../../lib/supabaseService';
import { getWeekOpensAt, formatETTime, getTimeUntil } from '../../lib/timezone';
import { findGamesWithoutLine } from '../../lib/missingLines';
import type { Game, Pick, Week } from '../../types';

/**
 * The pick sheet, wired to data.
 *
 * `PicksView` is deliberately left as a pure component that takes a week, its
 * games and the member's picks — it holds the locking rules, which are the part
 * worth testing without a database attached. This is the container that feeds
 * it: loading, errors, saving, and the two empty states below.
 *
 * TWO STATES THAT ARE NOT ERRORS, and this screen is judged on getting them
 * right rather than on the happy path:
 *
 *   THE WEEK IS NOT OPEN YET. A week's schedule and lines are captured together
 *   on the Tuesday it opens, so between Monday night and Tuesday 18:00 ET the
 *   current week genuinely has a row and no games. That is not a failure and
 *   must not read like one — the member is told when it opens.
 *
 *   A GAME HAS NO LINE. The book had it OFF at capture time. It appears on the
 *   sheet but cannot be picked (GameCard derives that), and it is called out
 *   here so a member does not think it is missing or that they have missed it.
 *
 * On mount it also fires `sync-week`, which is how scores land: nothing else in
 * the app is time-triggered between Tuesdays, so results appear because members
 * open a page. It runs AFTER first paint so the sheet is never waiting on ESPN.
 */

interface Loaded {
  week: Week;
  games: Game[];
  myPicks: Pick[];
}

export const PicksPage: React.FC = () => {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const load = useCallback(async (): Promise<Loaded> => {
    const week = await getCurrentWeek();
    // Games and picks are independent reads; no reason to wait twice.
    const [games, myPicks] = await Promise.all([
      getGamesForWeek(week.id),
      getPicksForWeek(week.id)
    ]);
    return { week, games, myPicks };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const first = await load();
        if (cancelled) return;
        setData(first);
        setError(null);

        // Best effort, after paint. A failed sync is not a failed page — the
        // sheet the member came for is already on screen.
        await syncWeek(first.week.id).catch(() => {});
        if (cancelled) return;

        const refreshed = await load();
        if (!cancelled) setData(refreshed);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleSave = useCallback(
    async (picks: PickSubmission[]) => {
      if (!data) return;
      setSaving(true);
      setSaveError(null);
      try {
        const saved = await savePicks(data.week.id, picks);
        setData(current => (current ? { ...current, myPicks: saved } : current));
        setSavedAt(new Date());
      } catch (err: any) {
        // save_picks raises messages written to be shown ("only one 3-point
        // pick per week"). Drop the function-name prefix and keep the sentence.
        const raw = err?.message ?? String(err);
        setSaveError(raw.replace(/^save_picks:\s*/, ''));
      } finally {
        setSaving(false);
      }
    },
    [data]
  );

  if (error) {
    return (
      <section className="mx-auto max-w-3xl">
        <h1 className="font-display text-3xl tracking-wide text-ink">Weekly Picks</h1>
        <p className="mt-4 text-muted">Could not load this week.</p>
        <p className="mt-2 font-mono text-sm text-faint">{error}</p>
        <Button className="mt-6" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </section>
    );
  }

  if (!data) {
    return <div className="p-8 text-muted">Loading this week…</div>;
  }

  const { week, games, myPicks } = data;

  // Not open yet: the week exists but its schedule has not been captured.
  if (games.length === 0) {
    const opensAt = getWeekOpensAt(week.weekNumber);
    return (
      <section className="mx-auto max-w-3xl">
        <h1 className="font-display text-4xl tracking-wide text-ink">
          Week {week.weekNumber}
        </h1>
        <div className="mt-6 rounded-card border border-line bg-surface-sunken p-6">
          <p className="text-ink">This week&rsquo;s sheet is not open yet.</p>
          <p className="mt-3 text-muted">
            The schedule and every line are set together on{' '}
            <span className="text-ink">{formatETTime(opensAt, 'EEEE d MMMM, h:mm a zzz')}</span>
            {' — '}
            {getTimeUntil(opensAt)} from now. Lines do not move after that, so
            everyone picks against the same numbers all week.
          </p>
        </div>
      </section>
    );
  }

  // Each of these has its OWN deadline — the earlier of its kickoff and the
  // Sunday sheet lock — so the banner names them one at a time. It used to say
  // "an admin can add a line before Sunday", which is true only of the last
  // game of the week and days wrong for a Thursday night one.
  const withoutLine = findGamesWithoutLine(games, week.weekNumber);

  return (
    <>
      {withoutLine.length > 0 && (
        <div className="mx-auto mb-4 max-w-3xl rounded-card border border-line bg-surface-sunken p-4 text-sm">
          <p className="text-ink">
            {withoutLine.length === 1
              ? 'One game has no line yet and cannot be picked:'
              : `${withoutLine.length} games have no line yet and cannot be picked:`}
          </p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {withoutLine.map(row => (
              <li key={row.game.id}>
                {row.matchup} —{' '}
                {row.locked ? (
                  <span className="text-faint">closed without one</span>
                ) : (
                  <span className="text-faint">
                    an admin has until{' '}
                    {formatETTime(row.deadline, 'EEE h:mm a zzz')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-faint">
            The book had these unopened when the week was set.
          </p>
        </div>
      )}

      {saveError && (
        <div className="mx-auto mb-4 max-w-3xl rounded-card border border-loss bg-surface-sunken p-4 text-sm text-ink">
          {saveError}
        </div>
      )}

      {savedAt && !saveError && !saving && (
        <div className="mx-auto mb-4 max-w-3xl text-sm text-muted">
          Saved {formatETTime(savedAt, 'h:mm a zzz')}.
        </div>
      )}

      <PicksView
        week={week}
        games={games}
        myPicks={myPicks}
        saving={saving}
        onSave={handleSave}
      />
    </>
  );
};
