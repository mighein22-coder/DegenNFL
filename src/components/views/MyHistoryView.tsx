import React, { useCallback, useMemo } from 'react';
import { EmptyNote, ErrorNote, LoadingNote, PageHeader } from '../Page';
import { useLoader } from '../../hooks/useLoader';
import { getAllPicks, getGamesForWeeks } from '../../lib/supabaseService';
import { buildHistory, type HistoryPick, type WeekHistory } from '../../lib/history';
import { formatSpread } from '../../lib/scoring';
import { formatETTime } from '../../lib/timezone';
import { BONUS_POINTS, TEAMS } from '../../constants';
import type { Profile } from '../../lib/supabase';
import type { Game, Pick } from '../../types';

/**
 * The member's own season, week by week.
 *
 * TWO ROUND TRIPS, NOT SEVENTEEN. The NHL app's history screen fetched a week's
 * games from inside the render, so a member late in the season paid one request
 * per week to see one page. Here the picks come back in one read, the week ids
 * are taken from them, and every game for those weeks arrives in a single
 * `.in()` — see `getGamesForWeeks`.
 *
 * The subtotals are scoped by the same `getSegmentForWeekId` the Standings
 * screen uses, so a week cannot count towards segment 2 there and segment 3
 * here. `buildHistory` holds that, and is tested without a database.
 *
 * Each row shows the line FROM THE SIDE THE MEMBER TOOK, not from the home
 * team's. Stored spreads are home-relative, which is the right storage
 * convention and the wrong reading convention: a member who took the road
 * underdog wants to see `+3.5`, not the `-3.5` that was written down.
 */

interface MyHistoryViewProps {
  profile: Profile;
}

interface Loaded {
  picks: Pick[];
  games: Game[];
}

export const MyHistoryView: React.FC<MyHistoryViewProps> = ({ profile }) => {
  const load = useCallback(async (): Promise<Loaded> => {
    const all = await getAllPicks();
    // `getAllPicks` returns other members' revealed picks too. This screen is
    // the member's own season; anyone else's row here would be a bug that reads
    // as a scoring error.
    const picks = all.filter(pick => pick.userId === profile.id);
    const weekIds = [...new Set(picks.map(pick => pick.weekId))];
    return { picks, games: await getGamesForWeeks(weekIds) };
  }, [profile.id]);

  const { data, error, loading, reload } = useLoader(load);

  const history = useMemo(
    () => (data ? buildHistory(data.picks, data.games) : []),
    [data]
  );

  const season = useMemo(() => {
    let points = 0;
    let wins = 0;
    let losses = 0;
    for (const segment of history) {
      points += segment.points;
      wins += segment.wins;
      losses += segment.losses;
    }
    return { points, wins, losses };
  }, [history]);

  if (error) {
    return (
      <section className="mx-auto max-w-3xl">
        <PageHeader title="My History" />
        <ErrorNote message="Could not load your season." detail={error} onRetry={reload} />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mx-auto max-w-3xl">
        <PageHeader title="My History" />
        {loading && <LoadingNote label="Loading your season…" />}
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl">
      <PageHeader
        title="My History"
        subtitle={
          history.length === 0 ? (
            'Your season, week by week.'
          ) : (
            <>
              {season.points} {season.points === 1 ? 'point' : 'points'} this season,{' '}
              {season.wins}-{season.losses} against the spread.
            </>
          )
        }
      />

      {history.length === 0 ? (
        <EmptyNote>
          No picks yet. Your sheet appears here the week after you submit one —
          with the line each pick was graded against.
        </EmptyNote>
      ) : (
        <div className="space-y-8">
          {history.map(entry => (
            <div key={entry.segment.number}>
              <div className="mb-3 flex items-end justify-between gap-4 border-b border-line pb-2">
                <h2 className="font-display text-2xl tracking-wide text-ink">
                  {entry.segment.label}
                  <span className="ml-2 text-base text-faint">
                    weeks {entry.segment.startWeek}–{entry.segment.endWeek}
                  </span>
                </h2>
                <p className="whitespace-nowrap text-sm text-muted">
                  <span className="font-mono tabular-nums text-ink">{entry.points}</span>{' '}
                  pts · {entry.wins}-{entry.losses}
                  {entry.pending > 0 && ` · ${entry.pending} pending`}
                </p>
              </div>

              <div className="space-y-3">
                {entry.weeks.map(week => (
                  <WeekCard key={week.weekId} week={week} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const WeekCard: React.FC<{ week: WeekHistory }> = ({ week }) => (
  <div className="rounded-card border border-line bg-surface p-4">
    <div className="flex items-end justify-between gap-4">
      <h3 className="font-display text-xl tracking-wide text-ink">
        Week {week.weekNumber}
      </h3>
      <p className="whitespace-nowrap text-sm text-muted">
        <span className="font-mono tabular-nums text-ink">{week.points}</span> pts ·{' '}
        {week.wins}-{week.losses}
        {week.pending > 0 && ` · ${week.pending} pending`}
      </p>
    </div>

    <ul className="mt-3 space-y-2">
      {week.picks.map(entry => (
        <PickRow key={entry.pick.gameId} entry={entry} />
      ))}
    </ul>
  </div>
);

const PickRow: React.FC<{ entry: HistoryPick }> = ({ entry }) => {
  const { pick, game } = entry;
  const team = TEAMS[pick.selectedTeamId];
  const isBonus = pick.confidence === BONUS_POINTS;

  const tone =
    pick.result === 'WIN'
      ? 'text-win'
      : pick.result === 'LOSS'
        ? 'text-loss'
        : 'text-muted';

  // The game row should always exist — picks are foreign-keyed to games. If it
  // somehow does not, the pick is still shown: dropping it would take its points
  // out of a subtotal with nothing on screen to explain the gap.
  const selectedIsHome = game != null && game.homeTeamId === pick.selectedTeamId;
  const opponentId = game
    ? selectedIsHome
      ? game.awayTeamId
      : game.homeTeamId
    : null;

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line pt-2 text-sm first:border-t-0 first:pt-0">
      <span className="font-display text-lg leading-none tracking-wide text-ink">
        {team?.abbreviation ?? pick.selectedTeamId}
      </span>

      <span className="font-mono tabular-nums text-muted">
        {game?.spread == null ? '—' : formatSpread(game.spread, selectedIsHome)}
      </span>

      <span className="text-faint">
        {opponentId
          ? `${selectedIsHome ? 'vs' : 'at'} ${TEAMS[opponentId]?.abbreviation ?? opponentId}`
          : 'game not found'}
      </span>

      {game?.status === 'FINAL' && game.homeScore != null && game.awayScore != null && (
        <span className="font-mono tabular-nums text-faint">
          {selectedIsHome
            ? `${game.homeScore}–${game.awayScore}`
            : `${game.awayScore}–${game.homeScore}`}
        </span>
      )}

      {game && game.status !== 'FINAL' && (
        <span className="text-faint">
          {formatETTime(new Date(game.startTime), 'EEE d MMM')}
        </span>
      )}

      <span className="ml-auto flex items-baseline gap-3 whitespace-nowrap">
        <span className={isBonus ? 'text-ink' : 'text-faint'}>
          {isBonus ? `bonus ×${BONUS_POINTS}` : '×1'}
        </span>
        <span className={`font-mono tabular-nums ${tone}`}>
          {pick.result === 'PENDING' ? 'pending' : pick.pointsEarned}
        </span>
      </span>
    </li>
  );
};
