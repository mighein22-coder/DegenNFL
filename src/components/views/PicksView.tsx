import React, { useMemo, useState } from 'react';
import { Button } from '../Button';
import { GameCard } from '../GameCard';
import {
  PICKS_PER_WEEK,
  ORDINARY_POINTS,
  BONUS_POINTS,
  BONUS_PICKS_PER_WEEK,
  ORDINARY_PICKS_PER_WEEK
} from '../../constants';
import { isPickLocked, getFinalLockAt, getTimeUntil } from '../../lib/timezone';
import type { Game, Pick, Week } from '../../types';
import type { PickSubmission } from '../../lib/supabaseService';

/**
 * The pick sheet.
 *
 * This is the screen the per-game locking rule actually costs something to
 * build, so the model is worth stating plainly:
 *
 *   * A sheet is FIVE picks: four worth 1 point and one worth 3. The 3 is the
 *     member's bonus game. `confidence` carries the point value itself, so it
 *     holds only 1 or 3 — there is no 2, and the 1s are not distinguishable
 *     from one another.
 *   * But games lock ONE AT A TIME, at their own kickoff, with a final lock for
 *     the whole week at Sunday 13:00 ET. So the sheet is not submitted as a
 *     unit. A Thursday game can be locked in while Sunday's are still open.
 *   * A locked pick's points are SPENT. Lock the bonus in on Thursday night and
 *     the 3 is gone for the week — the selector must not offer it again. The
 *     same is true of the four 1s once all four are locked.
 *   * A partial sheet is therefore a normal state, not an error. The save RPC
 *     accepts it; only the unlocked rows are replaced.
 *
 * The consequence for this component: what is still assignable is derived from
 * locked picks plus current draft selections TOGETHER, never from the draft
 * alone. Getting that wrong is how a member ends up unable to submit.
 *
 * Only the bonus needs the 'move it rather than duplicate it' behaviour below.
 * Ordinary picks are interchangeable, so there is nothing to move — they are
 * only ever capped.
 */

interface PicksViewProps {
  week: Week;
  games: Game[];
  /** The signed-in member's existing picks for this week. */
  myPicks: Pick[];
  saving?: boolean;
  onSave: (picks: PickSubmission[]) => void;
}

interface Draft {
  selectedTeamId: string;
  confidence?: number;
}

export const PicksView: React.FC<PicksViewProps> = ({
  week,
  games,
  myPicks,
  saving,
  onSave
}) => {
  const now = new Date();

  const lockedByGameId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const game of games) {
      map.set(game.id, isPickLocked(week.weekNumber, game.startTime, now));
    }
    return map;
    // `now` is intentionally captured per render: this recomputes on any state
    // change, which is enough. A game that locks while the page sits idle is
    // caught server-side by save_picks regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, week.weekNumber]);

  const lockedPicks = useMemo(
    () => myPicks.filter(p => lockedByGameId.get(p.gameId)),
    [myPicks, lockedByGameId]
  );

  // Draft state starts from the picks that are still open to change. Locked
  // ones are deliberately excluded — they are not ours to edit or to send.
  const [draft, setDraft] = useState<Record<string, Draft>>(() => {
    const initial: Record<string, Draft> = {};
    for (const pick of myPicks) {
      if (lockedByGameId.get(pick.gameId)) continue;
      initial[pick.gameId] = {
        selectedTeamId: pick.selectedTeamId,
        confidence: pick.confidence
      };
    }
    return initial;
  });

  /**
   * How much of the week's allowance is already committed.
   *
   * Locked picks and draft picks are counted TOGETHER. Points burned on a
   * locked Thursday game are gone for the week — the database enforces that
   * with picks_one_bonus_per_week and picks_enforce_sheet_shape, and save_picks
   * reports it as 'only one 3-point pick per week'. Offering a value here that
   * the sheet cannot hold would just produce that error at submit time.
   */
  const spent = useMemo(() => {
    let ones = 0;
    let bonus = 0;
    const count = (value?: number) => {
      if (value === BONUS_POINTS) bonus++;
      else if (value === ORDINARY_POINTS) ones++;
    };
    for (const pick of lockedPicks) count(pick.confidence);
    for (const entry of Object.values(draft)) count(entry.confidence);
    return { ones, bonus };
  }, [lockedPicks, draft]);

  /**
   * Values offered for one game: whatever the week can still hold, plus this
   * game's own current value — so re-opening the control never hides the number
   * already assigned to it.
   */
  const pointOptions = (current?: number): number[] => {
    const options: number[] = [];
    if (spent.ones < ORDINARY_PICKS_PER_WEEK || current === ORDINARY_POINTS) {
      options.push(ORDINARY_POINTS);
    }
    if (spent.bonus < BONUS_PICKS_PER_WEEK || current === BONUS_POINTS) {
      options.push(BONUS_POINTS);
    }
    return options;
  };

  const setConfidence = (gameId: string, raw: string) => {
    const value = raw === '' ? undefined : Number(raw);
    setDraft(prev => {
      const existing = prev[gameId];
      if (!existing) return prev;

      const next = { ...prev, [gameId]: { ...existing, confidence: value } };

      // Naming a new bonus game MOVES the bonus rather than creating a second
      // one the database would reject at submit time. The selector does not
      // offer a taken bonus, but a stale render could.
      //
      // Ordinary picks need no equivalent: they are interchangeable, so there
      // is nothing to move. Too many of them is prevented by not offering the
      // value in the first place.
      if (value === BONUS_POINTS) {
        for (const [otherId, other] of Object.entries(prev)) {
          if (otherId !== gameId && other.confidence === BONUS_POINTS) {
            next[otherId] = { ...other, confidence: undefined };
          }
        }
      }
      return next;
    });
  };

  const selectTeam = (gameId: string, teamId: string) => {
    setDraft(prev => {
      const existing = prev[gameId];
      // Clicking the selected team again clears the pick and frees its value.
      if (existing?.selectedTeamId === teamId) {
        const { [gameId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [gameId]: { ...existing, selectedTeamId: teamId } };
    });
  };

  const draftEntries = Object.entries(draft);
  const complete = draftEntries.filter(([, d]) => d.confidence != null);
  const totalPicked = lockedPicks.length + complete.length;

  const handleSave = () => {
    // Only the unlocked picks are sent. save_picks preserves the locked ones,
    // so omitting them is correct rather than a deletion.
    onSave(
      complete.map(([gameId, d]) => ({
        gameId,
        selectedTeamId: d.selectedTeamId,
        confidence: d.confidence!
      }))
    );
  };

  const finalLock = getFinalLockAt(week.weekNumber);
  const openGames = games.filter(g => !lockedByGameId.get(g.id));
  const closedGames = games.filter(g => lockedByGameId.get(g.id));

  // One control, rendered twice — beside the header and again at the foot of
  // the sheet, so a long week is never a scroll away from saving. Built here
  // rather than written out twice: the two must never disagree about whether
  // the sheet is saveable, or one of them lies about it.
  const saveButton = (size: 'md' | 'lg', className: string) => (
    <Button
      size={size}
      className={className}
      isLoading={saving}
      disabled={complete.length === 0}
      onClick={handleSave}
    >
      Save picks
    </Button>
  );

  return (
    <section className="mx-auto max-w-3xl pb-24">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-4xl tracking-wide text-ink">
            Week {week.weekNumber}
          </h1>
          <p className="mt-2 text-muted">
            {totalPicked} of {PICKS_PER_WEEK} picked
            {' · '}
            {spent.bonus > 0 ? 'bonus set' : 'bonus not set'}
            {' · '}
            sheet closes {getTimeUntil(finalLock, now)}
            {lockedPicks.length > 0 && ` · ${lockedPicks.length} already locked in`}
          </p>
        </div>

        {openGames.length > 0 && saveButton('md', 'shrink-0')}
      </header>

      {openGames.length > 0 && (
        <div className="mb-8 space-y-3">
          <h2 className="font-display text-xl tracking-wide text-muted">Open</h2>
          {openGames.map(game => {
            const entry = draft[game.id];
            return (
              <div key={game.id}>
                <GameCard
                  game={game}
                  selectedTeamId={entry?.selectedTeamId}
                  confidence={entry?.confidence}
                  locked={false}
                  onSelectTeam={teamId => selectTeam(game.id, teamId)}
                />

                {/* The selector only appears once a side is chosen — points
                    with no team attached are not a pick. */}
                {entry?.selectedTeamId && (
                  <label className="mt-2 flex items-center gap-2 px-1 text-sm text-muted">
                    Worth
                    <select
                      className="rounded-control border border-line bg-surface px-2 py-1 text-ink"
                      value={entry.confidence ?? ''}
                      onChange={e => setConfidence(game.id, e.target.value)}
                    >
                      <option value="">—</option>
                      {pointOptions(entry.confidence).map(c => (
                        <option key={c} value={c}>
                          {c === BONUS_POINTS ? '3 pts — bonus' : '1 pt'}
                        </option>
                      ))}
                    </select>
                    {entry.confidence == null && (
                      <span className="text-faint">not counted until set</span>
                    )}
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}

      {closedGames.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-display text-xl tracking-wide text-muted">Locked</h2>
          {closedGames.map(game => {
            const pick = myPicks.find(p => p.gameId === game.id);
            return (
              <GameCard
                key={game.id}
                game={game}
                selectedTeamId={pick?.selectedTeamId}
                confidence={pick?.confidence}
                locked
              />
            );
          })}
        </div>
      )}

      {openGames.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface-sunken p-4 md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
          {saveButton('lg', 'w-full')}
        </div>
      )}
    </section>
  );
};
