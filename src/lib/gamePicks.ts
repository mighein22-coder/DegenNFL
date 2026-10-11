import { BONUS_POINTS } from '../constants';
import { formatETTime, getFinalLockAt, getTimeUntil, isPickLocked } from './timezone';
import type { Profile } from './supabase';
import type { Game, Pick } from '../types';

/**
 * Who picked a particular game (issue #44).
 *
 * THE SCREEN ONLY EVER SHOWS A REVEALED GAME. `picks_select_visible` returns
 * another member's pick once `pick_revealed(game_id)` is true — the same
 * expression as `isPickLocked` — and until then the only pick in the data is
 * your own. A tally over that would say 'one person took PHI' about a game
 * the whole league has picked, so an unrevealed game is not summarised at all.
 *
 * That is also what makes the 'didn't pick' list safe. A revealed game is a
 * locked game, and a locked game takes no new picks, so a member missing from
 * both sides really did not pick it — there is no hidden pick that could
 * explain the gap, which is the one thing the Matrix cannot say about a blank
 * cell.
 */

export type GameAvailability =
  | { revealed: true }
  /** `label` is what the picker says in place of the game: when it opens. */
  | { revealed: false; label: string };

/**
 * Whether the picks on a game can be shown, and if not, when they can.
 *
 * Asks `isPickLocked`, so a Thursday game opens at its own kickoff and every
 * later game opens at the Sunday 1:00 PM ET lock if that comes first — in step
 * with the Matrix column filling in, because it is the same rule.
 */
export function gameAvailability(
  weekNumber: number,
  game: Game,
  now: Date
): GameAvailability {
  if (isPickLocked(weekNumber, game.startTime, now)) return { revealed: true };

  // Not locked, so both kickoff and the Sunday lock are still ahead; the picks
  // open at whichever comes first.
  const kickoff = new Date(game.startTime);
  const finalLock = getFinalLockAt(weekNumber);
  const opensAt = kickoff <= finalLock ? kickoff : finalLock;

  return {
    revealed: false,
    label: `Opens ${formatETTime(opensAt, 'EEE h:mm a')} ET · in ${getTimeUntil(opensAt, now)}`
  };
}

export interface SidePick {
  member: Profile;
  pick: Pick;
}

export interface GameSide {
  teamId: string;
  /** Bonus picks first, then by name — a stable order for a list people compare. */
  picks: SidePick[];
  /** How many of them were the 3-point pick. */
  bonusCount: number;
}

export interface GamePicksSummary {
  home: GameSide;
  away: GameSide;
  /** Members with no pick on this game. Only meaningful once it is revealed. */
  noPick: Profile[];
}

function byBonusThenName(a: SidePick, b: SidePick): number {
  const aBonus = a.pick.confidence === BONUS_POINTS ? 1 : 0;
  const bBonus = b.pick.confidence === BONUS_POINTS ? 1 : 0;
  return bBonus - aBonus || a.member.name.localeCompare(b.member.name);
}

/**
 * Split the picks on one game into its two sides, plus the members on neither.
 *
 * Only call it for a revealed game — see the note at the top of the file.
 * Picks for a different game are ignored, and so is a pick for a team that is
 * on neither side of this one, which cannot be written but would otherwise
 * count a member as having picked while listing them nowhere.
 */
export function summarizeGamePicks(
  game: Game,
  picks: Pick[],
  members: Profile[]
): GamePicksSummary {
  const byId = new Map(members.map(member => [member.id, member]));
  const home: SidePick[] = [];
  const away: SidePick[] = [];
  const picked = new Set<string>();

  for (const pick of picks) {
    if (pick.gameId !== game.id) continue;
    const member = byId.get(pick.userId);
    if (!member) continue;

    if (pick.selectedTeamId === game.homeTeamId) home.push({ member, pick });
    else if (pick.selectedTeamId === game.awayTeamId) away.push({ member, pick });
    else continue;

    picked.add(member.id);
  }

  const side = (teamId: string, list: SidePick[]): GameSide => ({
    teamId,
    picks: [...list].sort(byBonusThenName),
    bonusCount: list.filter(entry => entry.pick.confidence === BONUS_POINTS).length
  });

  return {
    home: side(game.homeTeamId, home),
    away: side(game.awayTeamId, away),
    noPick: members
      .filter(member => !picked.has(member.id))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}
