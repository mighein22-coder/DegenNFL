/**
 * Against-the-spread scoring.
 *
 * The pool picks games against a line rather than straight up, which is the
 * main way this app differs from the NHL original. Two functions, both pure,
 * both small, and between them they decide who wins money — so they get their
 * own file and their own tests rather than living inside a service.
 *
 * The design turns on one rule: **every spread the app stores ends in a half
 * point**. A line of -3 becomes -3.5 before it is ever written. That single
 * normalisation is what lets the rest of the system stay simple:
 *
 *   - no PUSH result to thread through the schema, the standings and the UI
 *   - `points_earned` stays an integer, so standings never show 27.5
 *   - `gradePick` has two branches instead of three
 *
 * It is enforced twice on purpose: here, at capture time, and again as a CHECK
 * constraint on `games.spread` in 0001_init.sql. The constraint is the one that
 * actually guarantees it — a bug here would otherwise produce a season of quiet
 * half-point ties that nobody notices until a payout is disputed.
 */

/** A line already stored by the app: guaranteed to end in .5. */
export type HookedSpread = number;

/**
 * Normalises a raw line to a half point.
 *
 * The half point is always added *against* the favourite — a 3-point favourite
 * lays 3.5, never 2.5. That makes the rule one sentence a pool member can be
 * told ("we always hook it the hard way") and means the adjustment never
 * depends on which team happens to be listed at home.
 *
 * A pick'em (0) has no favourite to move against, so home lays the half point
 * by convention. This is arbitrary — away -0.5 would be equally defensible —
 * but it is deterministic, and pick'em lines are rare.
 *
 * @param raw The line from the odds feed, from the HOME team's point of view.
 *            Negative means home is favoured.
 */
export function hookSpread(raw: number): HookedSpread {
  if (!Number.isFinite(raw)) {
    throw new Error(`hookSpread: expected a finite number, got ${raw}`);
  }

  // Already hooked (any x.5 value) — leave it exactly as the market set it.
  if (Math.abs(raw * 2) % 2 === 1) return raw;

  if (!Number.isInteger(raw)) {
    // Quarter-points and the like: no sportsbook posts them on a side, and
    // silently rounding one would change what the pool is playing. Refuse.
    throw new Error(
      `hookSpread: expected a whole or half point line, got ${raw}`
    );
  }

  // Pick'em: nobody is favoured, so home lays the hook.
  if (raw === 0) return -0.5;

  // Whole number: push the magnitude out, keeping the side.
  return raw < 0 ? raw - 0.5 : raw + 0.5;
}

export type PickResult = 'WIN' | 'LOSS';

/**
 * Grades one pick against the final score.
 *
 * `cover` is how many points the selected side won by *after* the line is
 * applied. Because the spread always ends in .5, `cover` always lands on a
 * half point too and can never be zero — which is why there is no third branch.
 *
 * Worked example, home favoured by 3.5 (`spread = -3.5`):
 *   home 27, away 20 → margin  7, home cover =  7 + (-3.5) =  3.5 → home WINS
 *   home 24, away 21 → margin  3, home cover =  3 + (-3.5) = -0.5 → home LOSES
 *                                 away cover = -3 - (-3.5) =  0.5 → away WINS
 *
 * @param homeScore     Final score, home team.
 * @param awayScore     Final score, away team.
 * @param spread        Hooked line from the HOME team's point of view.
 * @param selectedIsHome Whether the pick was on the home side.
 */
export function gradePick(
  homeScore: number,
  awayScore: number,
  spread: HookedSpread,
  selectedIsHome: boolean
): PickResult {
  if (Math.abs(spread * 2) % 2 !== 1) {
    // A whole-number line here means something upstream skipped hookSpread and
    // the CHECK constraint. Fail loudly rather than grade a game that can tie.
    throw new Error(
      `gradePick: spread ${spread} is not hooked to a half point`
    );
  }

  const margin = homeScore - awayScore;
  const cover = selectedIsHome ? margin + spread : -margin - spread;

  return cover > 0 ? 'WIN' : 'LOSS';
}

/** Points a graded pick is worth: its confidence on a win, nothing on a loss. */
export function pointsFor(result: PickResult, confidence: number): number {
  return result === 'WIN' ? confidence : 0;
}

/**
 * Formats a line for display next to a matchup, from one team's point of view.
 * Favourites show a minus, underdogs a plus: `-3.5`, `+7.5`.
 */
export function formatSpread(spread: HookedSpread, forHome: boolean): string {
  const value = forHome ? spread : -spread;
  return value > 0 ? `+${value}` : `${value}`;
}
