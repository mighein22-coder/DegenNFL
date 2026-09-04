import React from 'react';
import { Lock } from 'lucide-react';
import { TEAMS } from '../constants';
import { formatSpread } from '../lib/scoring';
import { formatETTime, getTimeUntil } from '../lib/timezone';
import type { Game } from '../types';

/**
 * One matchup on the pick sheet.
 *
 * Two things here that the NHL app's card has no concept of:
 *
 *   1. THE LINE. Shown against both teams, so a member reads "PHI -3.5 / DAL
 *      +3.5" rather than having to work out who is favoured. The number shown
 *      is the hooked one the pool will actually grade against, never the raw
 *      market line — see hookSpread() in lib/scoring.ts.
 *   2. PER-GAME LOCKING. This game closes at its own kickoff, which may be days
 *      before the rest of the sheet. A locked card shows its pick frozen rather
 *      than disappearing, because the point value it consumed is still spent
 *      for the week and the member needs to see why.
 *   3. NO LINE, NO PICK. A game the book never opened has a null spread until
 *      an admin sets one. It is shown, but it cannot be selected — save_picks
 *      and the RLS policy both reject a pick on it, so offering the choice
 *      would only produce an error at submit time. That is derived here from
 *      the game itself rather than passed in, so no call site can forget it.
 */

interface GameCardProps {
  game: Game;
  /** The team currently picked in this game, if any. */
  selectedTeamId?: string;
  /** The confidence assigned to this game, if any. */
  confidence?: number;
  /** Closed to further change — kickoff has passed, or the week's final lock has. */
  locked: boolean;
  onSelectTeam?: (teamId: string) => void;
}

export const GameCard: React.FC<GameCardProps> = ({
  game,
  selectedTeamId,
  confidence,
  locked,
  onSelectTeam
}) => {
  const home = TEAMS[game.homeTeamId];
  const away = TEAMS[game.awayTeamId];
  const kickoff = new Date(game.startTime);

  /** No number to pick against yet. Distinct from locked, and it can be fixed. */
  const awaitingLine = game.spread == null;

  const renderTeam = (teamId: string, isHome: boolean) => {
    const team = TEAMS[teamId];
    const picked = selectedTeamId === teamId;

    return (
      <button
        type="button"
        disabled={locked || awaitingLine || !onSelectTeam}
        onClick={() => onSelectTeam?.(teamId)}
        className={[
          'flex flex-1 items-center gap-3 rounded-control border p-3 text-left transition-colors',
          picked
            ? 'border-brand-400 bg-brand-900/40'
            : 'border-line bg-surface hover:bg-surface-raised',
          locked || awaitingLine ? 'cursor-default opacity-70' : 'cursor-pointer'
        ].join(' ')}
      >
        <span
          aria-hidden
          className="h-8 w-1.5 shrink-0 rounded-full"
          // The club's own colour, not a design token — see constants.ts.
          style={{ backgroundColor: team?.logoColor ?? 'transparent' }}
        />
        <span className="min-w-0">
          <span className="block truncate font-display text-lg leading-none">
            {team?.city ?? teamId}
          </span>
          <span className="block truncate text-sm text-muted">{team?.name ?? ''}</span>
        </span>
        <span className="ml-auto font-mono text-sm tabular-nums text-muted">
          {game.spread == null ? '—' : formatSpread(game.spread, isHome)}
        </span>
      </button>
    );
  };

  return (
    <article className="rounded-card border border-line bg-surface-sunken p-4">
      <header className="mb-3 flex items-center justify-between text-sm text-muted">
        <span>
          {formatETTime(kickoff, 'EEE h:mm a zzz')}
          {awaitingLine && (
            <span className="ml-2 text-faint">no line yet — cannot be picked</span>
          )}
        </span>

        {locked ? (
          <span className="flex items-center gap-1.5 text-faint">
            <Lock size={14} aria-hidden />
            {confidence != null ? `Locked at ${confidence}` : 'Locked'}
          </span>
        ) : (
          <span className="tabular-nums">{getTimeUntil(kickoff)}</span>
        )}
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        {renderTeam(game.awayTeamId, false)}
        {/* Away @ home, the way a schedule is written. Decorative to the eye,
            but it is the only thing on the card that says which side is at
            home, so it is spelled out for a screen reader rather than hidden. */}
        <span className="self-center px-1 text-sm text-faint">
          <span aria-hidden>@</span>
          <span className="sr-only">at</span>
        </span>
        {renderTeam(game.homeTeamId, true)}
      </div>

      {game.status === 'FINAL' && game.homeScore != null && game.awayScore != null && (
        <footer className="mt-3 text-center font-mono text-sm tabular-nums text-muted">
          Final · {away?.abbreviation ?? game.awayTeamId} {game.awayScore} –{' '}
          {game.homeScore} {home?.abbreviation ?? game.homeTeamId}
        </footer>
      )}
    </article>
  );
};
