import React, { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { EmptyNote, ErrorNote, LoadingNote, PageHeader } from '../Page';
import { MemberAvatar } from '../MemberAvatar';
import { PickChip } from '../PickChip';
import { useLoader } from '../../hooks/useLoader';
import { useRegisterRefresh } from '../../hooks/useRegisterRefresh';
import { useNow } from '../../hooks/useNow';
import {
  getAllPicks,
  getAllWeeks,
  getGamesForWeeks,
  getProfiles
} from '../../lib/supabaseService';
import { formatSpread } from '../../lib/scoring';
import { getCurrentWeekNumber } from '../../lib/timezone';
import {
  gameAvailability,
  summarizeGamePicks,
  type GameSide
} from '../../lib/gamePicks';
import { TEAMS } from '../../constants';
import type { Profile } from '../../lib/supabase';
import type { Game, Pick, Week } from '../../types';

/**
 * Who picked a particular game (issue #44), at /matrix/game/:gameId.
 *
 * A game is only shown once its picks are revealed — kickoff, or the Sunday
 * 1:00 PM ET lock if that comes first (`gameAvailability`, which is the same
 * `isPickLocked` the Matrix and the database use). Before that the only pick in
 * the data is the signed-in member's own, and a tally of one would read as
 * 'nobody else took this game'. So an unrevealed game stays in the picker,
 * greyed, saying when it opens, and a link straight to one says the same
 * rather than rendering an empty list.
 *
 * What that buys is a complete answer: a revealed game is locked, so a member
 * listed under 'No pick' really did not make one. The Matrix cannot say that of
 * a blank cell.
 *
 * ONE LOAD COVERS THE SEASON, like the Matrix: weeks, games, picks and
 * profiles are fetched once and the week and game selectors filter in memory.
 * Nothing new is asked of the database — `picks_select_visible` already hands
 * back exactly the picks that may be shown.
 */

interface GamePicksViewProps {
  profile: Profile;
}

interface Loaded {
  weeks: Week[];
  games: Game[];
  picks: Pick[];
  profiles: Profile[];
}

const abbr = (teamId: string) => TEAMS[teamId]?.abbreviation ?? teamId;

export const GamePicksView: React.FC<GamePicksViewProps> = ({ profile }) => {
  const now = useNow();
  const navigate = useNavigate();
  const { gameId } = useParams<{ gameId?: string }>();
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
  useRegisterRefresh(reload, loading);

  // Weeks with a schedule, as on the Matrix.
  const playedWeeks = useMemo(() => {
    if (!data) return [];
    const withGames = new Set(data.games.map(game => game.weekId));
    return data.weeks.filter(week => withGames.has(week.id));
  }, [data]);

  const linkedGame = useMemo(
    () => (data && gameId ? data.games.find(game => game.id === gameId) ?? null : null),
    [data, gameId]
  );

  // The week the picker shows: the one chosen, else the linked game's, else the
  // current week if it has a schedule, else the latest that does.
  const week = useMemo(() => {
    if (playedWeeks.length === 0) return null;
    const byId = (id: string | null | undefined) =>
      id ? playedWeeks.find(w => w.id === id) : undefined;
    const current = getCurrentWeekNumber(now);
    return (
      byId(selectedWeekId) ??
      byId(linkedGame?.weekId) ??
      playedWeeks.find(w => w.weekNumber === current) ??
      [...playedWeeks].sort((a, b) => b.weekNumber - a.weekNumber)[0]
    );
  }, [playedWeeks, selectedWeekId, linkedGame, now]);

  const games = useMemo(
    () =>
      data && week
        ? data.games
            .filter(game => game.weekId === week.id)
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        : [],
    [data, week]
  );

  const header = (
    <PageHeader
      title="Game Picks"
      subtitle="Who picked each side of a game."
      actions={
        week && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Week
            <select
              value={week.id}
              onChange={event => {
                setSelectedWeekId(event.target.value);
                // A game from another week no longer belongs under this picker.
                if (linkedGame && linkedGame.weekId !== event.target.value) {
                  navigate('/matrix/game');
                }
              }}
              className="min-h-11 rounded-control border border-line bg-surface px-2 py-1.5 text-base text-ink md:min-h-0 md:text-sm"
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
        )
      }
    />
  );

  if (error) {
    return (
      <section className="mx-auto max-w-6xl">
        <PageHeader title="Game Picks" />
        <ErrorNote message="Could not load the picks." detail={error} onRetry={reload} />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mx-auto max-w-6xl">
        <PageHeader title="Game Picks" />
        {loading && <LoadingNote label="Loading the season…" />}
      </section>
    );
  }

  if (!week) {
    return (
      <section className="mx-auto max-w-6xl">
        <PageHeader title="Game Picks" />
        <EmptyNote>
          No week has a schedule yet. Games and lines are set together on the Tuesday a
          week opens.
        </EmptyNote>
      </section>
    );
  }

  const chosen = linkedGame && linkedGame.weekId === week.id ? linkedGame : null;
  const chosenAvailability = chosen ? gameAvailability(week.weekNumber, chosen, now) : null;

  return (
    <section className="mx-auto max-w-6xl">
      <Link
        to="/matrix"
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:text-ink md:min-h-0"
      >
        <ArrowLeft size={16} aria-hidden /> League Matrix
      </Link>
      {header}

      {gameId && !linkedGame && (
        <div className="mb-4">
          <EmptyNote>That game could not be found. Pick one below.</EmptyNote>
        </div>
      )}

      <nav aria-label="Games" className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {games.map(game => {
          const availability = gameAvailability(week.weekNumber, game, now);
          const matchup = (
            <>
              <span className="block font-display text-sm tracking-wide">
                {abbr(game.awayTeamId)} @ {abbr(game.homeTeamId)}
              </span>
              <span className="block text-[11px] text-faint">
                {availability.revealed
                  ? game.spread == null
                    ? 'no line'
                    : `${abbr(game.homeTeamId)} ${formatSpread(game.spread, true)}`
                  : availability.label}
              </span>
            </>
          );

          if (!availability.revealed) {
            return (
              <span
                key={game.id}
                aria-disabled="true"
                className="rounded-control border border-line bg-surface px-3 py-2 text-faint opacity-70"
              >
                {matchup}
              </span>
            );
          }

          return (
            <Link
              key={game.id}
              to={`/matrix/game/${game.id}`}
              aria-current={game.id === chosen?.id ? 'page' : undefined}
              className={[
                'flex min-h-11 flex-col justify-center rounded-control border px-3 py-2 transition-colors',
                game.id === chosen?.id
                  ? 'border-brand-400 bg-brand-900/40 text-ink'
                  : 'border-line bg-surface text-muted hover:bg-surface-raised hover:text-ink'
              ].join(' ')}
            >
              {matchup}
            </Link>
          );
        })}
      </nav>

      {chosen && chosenAvailability && !chosenAvailability.revealed && (
        <EmptyNote>
          Picks on {abbr(chosen.awayTeamId)} @ {abbr(chosen.homeTeamId)} are not public yet.{' '}
          {chosenAvailability.label}.
        </EmptyNote>
      )}

      {chosen && chosenAvailability?.revealed && (
        <GameDetail game={chosen} data={data} profile={profile} />
      )}

      {!chosen && !(gameId && !linkedGame) && (
        <EmptyNote>
          Choose a game to see who took each side. A game opens at kickoff, or at the
          Sunday 1:00 PM ET lock if that comes first.
        </EmptyNote>
      )}
    </section>
  );
};

const GameDetail: React.FC<{ game: Game; data: Loaded; profile: Profile }> = ({
  game,
  data,
  profile
}) => {
  const summary = useMemo(
    () => summarizeGamePicks(game, data.picks, data.profiles),
    [game, data.picks, data.profiles]
  );

  const score =
    game.status === 'FINAL' && game.homeScore != null && game.awayScore != null
      ? `Final ${abbr(game.awayTeamId)} ${game.awayScore}, ${abbr(game.homeTeamId)} ${game.homeScore}`
      : null;

  return (
    <div>
      <h2 className="font-display text-2xl tracking-wide text-ink">
        {abbr(game.awayTeamId)} @ {abbr(game.homeTeamId)}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {game.spread == null
          ? 'No line'
          : `${abbr(game.homeTeamId)} ${formatSpread(game.spread, true)}`}
        {score && ` · ${score}`}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <SidePanel side={summary.away} profile={profile} />
        <SidePanel side={summary.home} profile={profile} />
      </div>

      <div className="mt-4 rounded-card border border-line bg-surface p-4">
        <h3 className="text-sm text-muted">
          No pick on this game{' '}
          <span className="font-mono tabular-nums text-faint">({summary.noPick.length})</span>
        </h3>
        {summary.noPick.length === 0 ? (
          <p className="mt-2 text-sm text-faint">Everybody picked this game.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
            {summary.noPick.map(member => (
              <li key={member.id}>{member.name}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const SidePanel: React.FC<{ side: GameSide; profile: Profile }> = ({ side, profile }) => {
  const team = TEAMS[side.teamId];
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl tracking-wide text-ink">
          {team ? `${team.city} ${team.name}` : side.teamId}
        </h3>
        <span className="text-sm text-muted">
          <span className="font-mono tabular-nums text-ink">{side.picks.length}</span>{' '}
          {side.picks.length === 1 ? 'pick' : 'picks'}
          {side.bonusCount > 0 && (
            <>
              {' · '}
              <span className="font-mono tabular-nums text-ink">{side.bonusCount}</span> as ×3
            </>
          )}
        </span>
      </div>

      {side.picks.length === 0 ? (
        <p className="mt-3 text-sm text-faint">Nobody took {abbr(side.teamId)}.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {side.picks.map(({ member, pick }) => (
            <li
              key={member.id}
              className={[
                'flex items-center justify-between gap-3 rounded-control px-2 py-1',
                member.id === profile.id ? 'bg-brand-900/30' : ''
              ].join(' ')}
            >
              <span className="flex min-w-0 items-center gap-2">
                <MemberAvatar name={member.name} avatar={member.avatar} size="sm" />
                <span className="truncate text-ink">{member.name}</span>
              </span>
              <PickChip pick={pick} label={abbr(pick.selectedTeamId)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
