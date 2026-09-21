import { formatETTime, getTimeUntil, isGameLocked, isPickLocked } from './timezone';
import type { Game } from '../types';

/**
 * What the League Matrix says under a game column, and why.
 *
 * Extracted from the view because the interesting part is not the string, it
 * is which of two locks decides it — and that is worth a test rather than a
 * ternary buried in a header cell (issue #29).
 *
 * The bug this replaces: the header asked `isGameLocked`, which is kickoff and
 * kickoff only, so a Monday night game read "hidden" all Monday morning while
 * the grid underneath it was already showing everyone's pick on that game. The
 * database reveals on `pick_locked()` — kickoff OR the week's final lock — so
 * the Sunday 13:00 ET deadline reveals the whole remaining sheet, Monday night
 * included. `isPickLocked` is that same expression, and asking it here is what
 * makes the header agree with the cells beneath it.
 */
export type MatrixColumnState =
  /** Final, with a score to show. */
  | 'SCORE'
  /** Kicked off — playing now, or finished but not yet scored. */
  | 'PLAYED'
  /** Not kicked off, but the week has closed, so every pick on it is visible. */
  | 'REVEALED'
  /** Not kicked off and the week is still open: picks on it are nobody's business yet. */
  | 'HIDDEN';

export interface MatrixColumn {
  state: MatrixColumnState;
  label: string;
}

/**
 * @param weekNumber The week the game belongs to — the final lock hangs off it.
 * @param game       The game the column is for.
 * @param now        Evaluated against this instant, which the view ticks.
 */
export function matrixColumnStatus(
  weekNumber: number,
  game: Game,
  now: Date
): MatrixColumn {
  if (game.status === 'FINAL' && game.homeScore != null && game.awayScore != null) {
    return { state: 'SCORE', label: `${game.awayScore}–${game.homeScore}` };
  }

  const kickoff = new Date(game.startTime);

  if (isGameLocked(kickoff, now)) {
    return { state: 'PLAYED', label: formatETTime(kickoff, 'EEE h:mm a') };
  }

  // Not kicked off. The only question left is whether the picks on it are out,
  // and after the Sunday lock they are — so the column has nothing to conceal
  // and says the one thing still unknown: when the game starts.
  const countdown = getTimeUntil(kickoff, now);

  return isPickLocked(weekNumber, kickoff, now)
    ? { state: 'REVEALED', label: `in ${countdown}` }
    : { state: 'HIDDEN', label: `hidden · ${countdown}` };
}
