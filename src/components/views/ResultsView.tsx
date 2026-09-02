import React, { useCallback, useMemo, useState } from 'react';
import { EmptyNote, ErrorNote, LoadingNote, PageHeader } from '../Page';
import { MemberAvatar } from '../MemberAvatar';
import { PickChip } from '../PickChip';
import { useLoader } from '../../hooks/useLoader';
import { useNow } from '../../hooks/useNow';
import {
  getAllPicks,
  getAllWeeks,
  getGamesForWeeks,
  getProfiles
} from '../../lib/supabaseService';
import { formatSpread } from '../../lib/scoring';
import {
  formatETTime,
  getCurrentWeekNumber,
  isGameLocked,
  getTimeUntil
} from '../../lib/timezone';
import { TEAMS } from '../../constants';
import type { Profile } from '../../lib/supabase';
import type { Game, Pick, Week } from '../../types';

/**
 * Every member's sheet for a week, once it is visible.
 *
 * WHAT IS ABSENT HERE IS THE POINT. Cells stay blank until that GAME kicks off
 * — not until the week locks. The RLS policy `picks_select_visible` already
 * enforces it (`auth.uid() = user_id or pick_revealed(game_id)`), so an
 * unrevealed pick is simply not in the data and there is nothing to hide in the
 * view. This screen must not therefore invent a reason for a blank cell: it can
 * mean 'not picked' or 'not yet revealed', and only the member who made it can
 * tell which. The column header says which state the game is in, and the note
 * under the grid says the rest.
 *
 * The spread shown is the FROZEN one on the game row — the number the results
 * were actually graded against, not whatever the market says now.
 *
 * One load covers the season. Weeks, games and picks are fetched once and the
 * week selector filters in memory, so flicking between weeks costs nothing;
 * `getGamesForWeeks` makes the games a single `.in()` rather than a request per
 * week.
 */

interface ResultsViewProps {
  profile: Profile;
}

interface Loaded {
  weeks: Week[];
  games: Game[];
  picks: Pick[];
  profiles: Profile[];
}

export const ResultsView: React.FC<ResultsViewProps> = ({ profile }) => {
  const now = useNow();
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Loaded> => {
    const [weeks, picks, profiles] = await Promise.all([
      getAllWeeks(),
      getAllPicks(),
      getProfiles()
    ]);
    const games = await getGamesForWeeks(weeks.map(week => week.id));
    return { weeks, games, picks, profiles };
  }, []);

  const { data, error, loading, reload } = useLoader(load);

  // Weeks that actually have a schedule. A week row exists from the moment
  // somebody opens the app in it, days before its games are seeded, and an
  // empty grid is not worth offering.
  const playedWeeks = useMemo(() => {
    if (!data) return [];
    const withGames = new Set(data.games.map(game => game.weekId));
    return data.weeks.filter(week => withGames.has(week.id));
  }, [data]);

  const week = useMemo(() => {
    if (playedWeeks.length === 0) return null;
    if (selectedWeekId) {
      const found = playedWeeks.find(w => w.id === selectedWeekId);
      if (found) return found;
    }
    const current = getCurrentWeekNumber(now);
    // The current week if it has a schedule, else the most recent one that does.
    return (
      playedWeeks.find(w => w.weekNumber === current) ??
      [...playedWeeks].sort((a, b) => b.weekNumber - a.weekNumber)[0]
    );
  }, [playedWeeks, selectedWeekId, now]);

  const games = useMemo(
    () =>
      data && week
        ? data.games
            .filter(game => game.weekId === week.id)
            .sort(
              (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
            )
        : [],
    [data, week]
  );

  const picksByUser = useMemo(() => {
    const map = new Map<string, Map<string, Pick>>();
    if (!data || !week) return map;
    for (const pick of data.picks) {
      if (pick.weekId !== week.id) continue;
      const byGame = map.get(pick.userId) ?? new Map<string, Pick>();
      byGame.set(pick.gameId, pick);
      map.set(pick.userId, byGame);
    }
    return map;
  }, [data, week]);

  // Members with a visible pick first, then everyone else alphabetically, so
  // the top of the grid is the part with something in it.
  const members = useMemo(() => {
    if (!data) return [];
    return [...data.profiles].sort((a, b) => {
      const aHas = (picksByUser.get(a.id)?.size ?? 0) > 0 ? 0 : 1;
      const bHas = (picksByUser.get(b.id)?.size ?? 0) > 0 ? 0 : 1;
      return aHas - bHas || a.name.localeCompare(b.name);
    });
  }, [data, picksByUser]);

  const weekTotal = (userId: string): number => {
    const byGame = picksByUser.get(userId);
    if (!byGame) return 0;
    let total = 0;
    for (const pick of byGame.values()) total += pick.pointsEarned;
    return total;
  };

  if (error) {
    return (
      <section className="mx-auto max-w-6xl">
        <PageHeader title="League Matrix" />
        <ErrorNote message="Could not load the matrix." detail={error} onRetry={reload} />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mx-auto max-w-6xl">
        <PageHeader title="League Matrix" />
        {loading && <LoadingNote label="Loading the season…" />}
      </section>
    );
  }

  if (!week) {
    return (
      <section className="mx-auto max-w-6xl">
        <PageHeader title="League Matrix" />
        <EmptyNote>
          No week has a schedule yet. Games and lines are set together on the
          Tuesday a week opens, and the grid appears with them.
        </EmptyNote>
      </section>
    );
  }

  const hiddenColumns = games.filter(game => !isGameLocked(game.startTime, now)).length;

  return (
    <section className="mx-auto max-w-6xl">
      <PageHeader
        title="League Matrix"
        subtitle={
          <>
            Week {week.weekNumber} — every sheet, against the lines the results
            were graded on.
          </>
        }
        actions={
          <label className="flex items-center gap-2 text-sm text-muted">
            Week
            <select
              value={week.id}
              onChange={event => setSelectedWeekId(event.target.value)}
              className="rounded-control border border-line bg-surface px-2 py-1.5 text-ink"
            >
              {[...playedWeeks]
                .sort((a, b) => b.weekNumber - a.weekNumber)
                .map(option => (
                  <option key={option.id} value={option.id}>
                    Week {option.weekNumber}
                  </option>
                ))}
            </select>
          </label>
        }
      />

      {/* Desktop: the grid. */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-faint">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-2 font-normal">
                Member
              </th>
              {games.map(game => (
                <th key={game.id} scope="col" className="px-2 py-2 font-normal">
                  <GameColumnHeader game={game} now={now} />
                </th>
              ))}
              <th scope="col" className="px-3 py-2 text-right font-normal">
                Pts
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map(member => {
              const byGame = picksByUser.get(member.id);
              return (
                <tr
                  key={member.id}
                  className={[
                    'border-t border-line',
                    member.id === profile.id ? 'bg-brand-900/30' : ''
                  ].join(' ')}
                >
                  {/* The name column is pinned while the games scroll. It needs
                      an OPAQUE background of its own — the row tint is painted
                      on the row, and a transparent sticky cell would let the
                      scrolling cells show through underneath it. Hence the own-
                      row marker is a border here rather than the tint. */}
                  <th
                    scope="row"
                    className={[
                      'sticky left-0 z-10 bg-surface px-3 py-2 text-left font-normal',
                      member.id === profile.id ? 'border-l-2 border-l-brand-400' : ''
                    ].join(' ')}
                  >
                    <span className="flex items-center gap-2">
                      <MemberAvatar name={member.name} avatar={member.avatar} size="sm" />
                      <span className="truncate text-ink">{member.name}</span>
                    </span>
                  </th>

                  {games.map(game => {
                    const pick = byGame?.get(game.id);
                    return (
                      <td key={game.id} className="px-2 py-2 align-middle">
                        {pick ? (
                          <PickChip
                            pick={pick}
                            label={
                              TEAMS[pick.selectedTeamId]?.abbreviation ??
                              pick.selectedTeamId
                            }
                          />
                        ) : (
                          <span className="text-faint">·</span>
                        )}
                      </td>
                    );
                  })}

                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                    {weekTotal(member.id)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: the grid does not fit, so it becomes a card per member. */}
      <div className="space-y-3 md:hidden">
        {members.map(member => {
          const byGame = picksByUser.get(member.id);
          const made = games.map(game => byGame?.get(game.id)).filter(Boolean) as Pick[];

          return (
            <div
              key={member.id}
              className={[
                'rounded-card border border-line p-4',
                member.id === profile.id ? 'bg-brand-900/30' : 'bg-surface'
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <MemberAvatar name={member.name} avatar={member.avatar} size="sm" />
                  <span className="truncate text-ink">{member.name}</span>
                </span>
                <span className="font-mono tabular-nums text-ink">
                  {weekTotal(member.id)}
                </span>
              </div>

              {made.length === 0 ? (
                <p className="mt-3 text-sm text-faint">Nothing visible yet.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {made.map(pick => (
                    <PickChip
                      key={pick.gameId}
                      pick={pick}
                      label={
                        TEAMS[pick.selectedTeamId]?.abbreviation ?? pick.selectedTeamId
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-faint">
        A blank cell means either no pick or a pick not yet revealed — picks
        become visible as each game kicks off, one game at a time, and until then
        nobody can see them.
        {hiddenColumns > 0 &&
          ` ${hiddenColumns} ${hiddenColumns === 1 ? 'game has' : 'games have'} not kicked off yet, so only your own picks show in ${hiddenColumns === 1 ? 'that column' : 'those columns'}.`}
      </p>
    </section>
  );
};

/**
 * One game's column header: the matchup, the frozen line, and where the game is.
 *
 * The spread is written from the home team's point of view, which is how it is
 * stored — so `PHI -3.5` against a home Philadelphia reads the same way it does
 * on the pick sheet.
 */
const GameColumnHeader: React.FC<{ game: Game; now: Date }> = ({ game, now }) => {
  const away = TEAMS[game.awayTeamId]?.abbreviation ?? game.awayTeamId;
  const home = TEAMS[game.homeTeamId]?.abbreviation ?? game.homeTeamId;
  const locked = isGameLocked(game.startTime, now);

  return (
    <span className="block whitespace-nowrap">
      <span className="block font-display text-sm tracking-wide text-ink">
        {away} @ {home}
      </span>
      <span className="block font-mono text-[11px] tabular-nums text-muted">
        {game.spread == null ? 'no line' : `${home} ${formatSpread(game.spread, true)}`}
      </span>
      <span className="block text-[11px] text-faint">
        {game.status === 'FINAL' && game.homeScore != null && game.awayScore != null
          ? `${game.awayScore}–${game.homeScore}`
          : locked
            ? formatETTime(new Date(game.startTime), 'EEE h:mm a')
            : `hidden · ${getTimeUntil(new Date(game.startTime), now)}`}
      </span>
    </span>
  );
};
