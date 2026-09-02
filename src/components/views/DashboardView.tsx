import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '../Button';
import { EmptyNote, ErrorNote, LoadingNote, PageHeader } from '../Page';
import { PickChip } from '../PickChip';
import { StandingsTable } from '../StandingsTable';
import { useLoader } from '../../hooks/useLoader';
import { useNow } from '../../hooks/useNow';
import {
  getAllPicks,
  getCurrentWeek,
  getGamesForWeek,
  getProfiles,
  syncWeek
} from '../../lib/supabaseService';
import { computeStandings } from '../../lib/standings';
import { summarizeSheet, type SheetSummary } from '../../lib/sheet';
import {
  formatETTime,
  getFinalLockAt,
  getTimeUntil,
  getWeekOpensAt
} from '../../lib/timezone';
import { PICKS_PER_WEEK, TEAMS } from '../../constants';
import type { Profile } from '../../lib/supabase';
import type { Game, Pick, Week } from '../../types';

/**
 * Where the week stands.
 *
 * This is the screen a member leaves open, so two things it would be easy to
 * get wrong are the whole job:
 *
 *   THE DEADLINE IS NOT ONE DEADLINE. Under per-game locking the next thing to
 *   close is usually a single kickoff, days before the Sunday 13:00 ET lock
 *   that closes the sheet. Showing only the Sunday one tells a member they have
 *   four days to change a Thursday pick they have already lost the right to
 *   touch. Both are shown, and the nearer one leads.
 *
 *   'SUBMITTED' IS NOT A STATE. A sheet with three picks locked in and two open
 *   is neither done nor undone. `summarizeSheet` resolves that into one status
 *   and the counts behind it; the call to action below follows the status
 *   rather than guessing from a pick count.
 *
 * It also fires `sync-week` after first paint, for the same reason PicksPage
 * does: nothing in this app is time-triggered between Tuesdays, so scores land
 * because somebody opened a page. This is the page most often opened.
 */

interface DashboardViewProps {
  profile: Profile;
}

interface Loaded {
  week: Week;
  games: Game[];
  /** Every pick this member is allowed to see, all season. */
  allPicks: Pick[];
  profiles: Profile[];
}

export const DashboardView: React.FC<DashboardViewProps> = ({ profile }) => {
  const navigate = useNavigate();
  const now = useNow();

  const load = useCallback(async (): Promise<Loaded> => {
    const week = await getCurrentWeek();
    // The season-wide pick read covers this week too, so there is no separate
    // getPicksForWeek here — one query fewer, and the standings below and the
    // sheet above can never disagree about what was picked.
    const [games, allPicks, profiles] = await Promise.all([
      getGamesForWeek(week.id),
      getAllPicks(),
      getProfiles()
    ]);
    return { week, games, allPicks, profiles };
  }, []);

  const { data, error, loading, reload } = useLoader(load);

  // Best effort, once per week id, after the page is already on screen. A
  // failed sync is not a failed page.
  const syncedWeeks = useRef(new Set<string>());
  useEffect(() => {
    const weekId = data?.week.id;
    if (!weekId || syncedWeeks.current.has(weekId)) return;
    syncedWeeks.current.add(weekId);
    void syncWeek(weekId).then(reload, () => {});
  }, [data?.week.id, reload]);

  const myPicks = useMemo(
    () =>
      data
        ? data.allPicks.filter(p => p.userId === profile.id && p.weekId === data.week.id)
        : [],
    [data, profile.id]
  );

  const sheet = useMemo(
    () => (data ? summarizeSheet(data.week.weekNumber, data.games, myPicks, now) : null),
    [data, myPicks, now]
  );

  const standings = useMemo(
    () => (data ? computeStandings(data.profiles, data.allPicks) : []),
    [data]
  );

  if (error) {
    return (
      <section className="mx-auto max-w-4xl">
        <PageHeader title="Dashboard" />
        <ErrorNote message="Could not load this week." detail={error} onRetry={reload} />
      </section>
    );
  }

  if (!data || !sheet) {
    return (
      <section className="mx-auto max-w-4xl">
        <PageHeader title="Dashboard" />
        {loading && <LoadingNote label="Loading this week…" />}
      </section>
    );
  }

  const { week } = data;
  const finalLock = getFinalLockAt(week.weekNumber);
  const opensAt = getWeekOpensAt(week.weekNumber);

  return (
    <section className="mx-auto max-w-4xl">
      <PageHeader
        title={`Week ${week.weekNumber}`}
        subtitle={<StatusLine sheet={sheet} />}
      />

      {sheet.status === 'NOT_OPEN' ? (
        <EmptyNote>
          <p className="text-ink">This week&rsquo;s sheet is not open yet.</p>
          <p className="mt-3">
            The schedule and every line are set together on{' '}
            <span className="text-ink">
              {formatETTime(opensAt, 'EEEE d MMMM, h:mm a zzz')}
            </span>
            {' — '}
            {getTimeUntil(opensAt, now)} from now. Lines do not move after that,
            so everyone picks against the same numbers all week.
          </p>
        </EmptyNote>
      ) : (
        <div className="grid gap-4 md:grid-cols-5">
          <div className="md:col-span-3">
            <SheetPanel sheet={sheet} onGoToPicks={() => navigate('/picks')} />
          </div>
          <div className="md:col-span-2">
            <DeadlinePanel sheet={sheet} finalLock={finalLock} now={now} />
          </div>
        </div>
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-display text-2xl tracking-wide text-ink">Standings</h2>
          <Link to="/standings" className="text-sm text-brand-400 hover:text-brand-300">
            Full table &amp; segments
          </Link>
        </div>
        {standings.length === 0 ? (
          <EmptyNote>Nothing scored yet — the table fills in as results land.</EmptyNote>
        ) : (
          <StandingsTable rows={standings} highlightUserId={profile.id} limit={5} compact />
        )}
      </div>
    </section>
  );
};

/** The one-line answer to &quot;where am I?&quot;, under the heading. */
const StatusLine: React.FC<{ sheet: SheetSummary }> = ({ sheet }) => {
  switch (sheet.status) {
    case 'NOT_OPEN':
      return <>The schedule and the lines are not set yet.</>;
    case 'EMPTY':
      return <>No picks in yet — {PICKS_PER_WEEK} to make.</>;
    case 'PARTIAL':
      return (
        <>
          {sheet.picked} of {PICKS_PER_WEEK} picked
          {sheet.bonusSet ? ', bonus set' : ', bonus not set'} — {sheet.remaining} to
          go.
        </>
      );
    case 'COMPLETE':
      return (
        <>
          All {PICKS_PER_WEEK} picked
          {sheet.lockedPicks.length > 0 &&
            `, ${sheet.lockedPicks.length} already locked in`}
          .
        </>
      );
    case 'LOCKED':
      return sheet.picked >= PICKS_PER_WEEK ? (
        <>The sheet is closed. All {PICKS_PER_WEEK} are in.</>
      ) : (
        <>
          The sheet is closed with {sheet.picked} of {PICKS_PER_WEEK} in
          {sheet.remaining > 0 && ` — ${sheet.remaining} unused`}.
        </>
      );
  }
};

/** The sheet itself: what is locked, what is open, and the one thing to do next. */
const SheetPanel: React.FC<{ sheet: SheetSummary; onGoToPicks: () => void }> = ({
  sheet,
  onGoToPicks
}) => {
  const cta: Record<SheetSummary['status'], string> = {
    NOT_OPEN: '',
    EMPTY: 'Make your picks',
    PARTIAL: 'Finish your sheet',
    COMPLETE: 'Review or change',
    LOCKED: ''
  };

  const label = cta[sheet.status];

  return (
    <div className="h-full rounded-card border border-line bg-surface p-5">
      <h2 className="font-display text-xl tracking-wide text-ink">Your sheet</h2>

      {sheet.lockedPicks.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-faint">
            <Lock size={12} aria-hidden />
            Locked in — these points are spent
          </p>
          <div className="flex flex-wrap gap-2">
            {sheet.lockedPicks.map(pick => (
              <PickChip
                key={pick.gameId}
                pick={pick}
                label={TEAMS[pick.selectedTeamId]?.abbreviation ?? pick.selectedTeamId}
              />
            ))}
          </div>
        </div>
      )}

      {sheet.openPicks.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-faint">
            Still changeable
          </p>
          <div className="flex flex-wrap gap-2">
            {sheet.openPicks.map(pick => (
              <PickChip
                key={pick.gameId}
                pick={pick}
                label={TEAMS[pick.selectedTeamId]?.abbreviation ?? pick.selectedTeamId}
              />
            ))}
          </div>
        </div>
      )}

      {sheet.picked === 0 && (
        <p className="mt-4 text-muted">
          Four games at 1 point and one at 3. Picked against the line, not on who
          wins.
        </p>
      )}

      {sheet.gamesWithoutLine.length > 0 && (
        <p className="mt-4 flex gap-2 text-sm text-muted">
          <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0 text-brand-400" />
          <span>
            {sheet.gamesWithoutLine.length === 1
              ? 'One game has'
              : `${sheet.gamesWithoutLine.length} games have`}{' '}
            no line and cannot be picked until an admin sets one.
          </span>
        </p>
      )}

      {label ? (
        <Button className="mt-5 w-full sm:w-auto" onClick={onGoToPicks}>
          {label}
        </Button>
      ) : (
        sheet.status === 'LOCKED' && (
          <p className="mt-5 text-sm text-muted">
            Nothing left to change this week.{' '}
            <Link to="/matrix" className="text-brand-400 hover:text-brand-300">
              See everyone&rsquo;s sheet
            </Link>
            .
          </p>
        )
      )}
    </div>
  );
};

/**
 * Both deadlines, nearest first.
 *
 * The next kickoff is the one that actually bites — it removes a game from the
 * sheet on its own, days before the week closes. The Sunday lock is shown
 * underneath because it closes everything at once regardless.
 */
const DeadlinePanel: React.FC<{ sheet: SheetSummary; finalLock: Date; now: Date }> = ({
  sheet,
  finalLock,
  now
}) => (
  <div className="h-full rounded-card border border-line bg-surface p-5">
    <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-ink">
      <Clock size={18} aria-hidden />
      Deadlines
    </h2>

    <div className="mt-4">
      <p className="text-xs uppercase tracking-wider text-faint">Next kickoff</p>
      {sheet.nextKickoff ? (
        <>
          <p className="font-mono text-2xl tabular-nums text-ink">
            {getTimeUntil(sheet.nextKickoff, now)}
          </p>
          <p className="text-sm text-muted">
            {formatETTime(sheet.nextKickoff, 'EEE d MMM, h:mm a zzz')} — that game
            closes on its own.
          </p>
        </>
      ) : (
        <p className="text-muted">Every game this week has kicked off.</p>
      )}
    </div>

    <div className="mt-5 border-t border-line pt-4">
      <p className="text-xs uppercase tracking-wider text-faint">Sheet closes</p>
      <p className="font-mono text-2xl tabular-nums text-ink">
        {getTimeUntil(finalLock, now)}
      </p>
      <p className="text-sm text-muted">
        {formatETTime(finalLock, 'EEEE h:mm a zzz')} — whatever has not kicked off
        by then closes anyway.
      </p>
    </div>
  </div>
);
