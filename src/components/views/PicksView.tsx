import React, { useMemo, useState } from 'react';
import { Button } from '../Button';
import { GameCard } from '../GameCard';
import { PICKS_PER_WEEK } from '../../constants';
import { isPickLocked, getFinalLockAt, getTimeUntil } from '../../lib/timezone';
import type { Game, Pick, Week } from '../../types';
import type { PickSubmission } from '../../lib/supabaseService';

/**
 * The pick sheet.
 *
 * This is the screen the per-game locking rule actually costs something to
 * build, so the model is worth stating plainly:
 *
 *   * A sheet is FIVE picks with confidence 1..5, no duplicates — same as the
 *     NHL app.
 *   * But games lock ONE AT A TIME, at their own kickoff, with a final lock for
 *     the whole week at Sunday 13:00 ET. So the sheet is not submitted as a
 *     unit. A Thursday game can be locked in while Sunday's are still open.
 *   * A locked pick's confidence is SPENT. If you locked 3 on Thursday night,
 *     3 is gone for the week and the selector must not offer it again.
 *   * A partial sheet is therefore a normal state, not an error. The save RPC
 *     accepts it; only the unlocked rows are replaced.
 *
 * The consequence for this component: `available confidences` is derived from
 * locked picks plus current draft selections together, never from the draft
 * alone. Getting that wrong is how a member ends up unable to submit.
 *
 * SCOPE: the state model below is real and is the part worth pinning down. The
 * confidence selector UI itself is left as the marked TODO — it is ordinary
 * component work, unlike the rule above.
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
   * Confidence values still available to assign.
   *
   * Locked picks and draft picks are considered TOGETHER. A value burned on a
   * locked Thursday game is gone for the week — the database enforces that via
   * a unique constraint, and save_picks reports it as
   * 'that confidence value is already locked in on another game'. Offering it
   * here would just produce that error at submit time.
   */
  const availableConfidences = useMemo(() => {
    const spent = new Set<number>();
    for (const pick of lockedPicks) spent.add(pick.confidence);
    for (const entry of Object.values(draft)) {
      if (entry.confidence != null) spent.add(entry.confidence);
    }
    return Array.from({ length: PICKS_PER_WEEK }, (_, i) => i + 1).filter(
      c => !spent.has(c)
    );
  }, [lockedPicks, draft]);

  /** Values offered for one game: those still free, plus its own current one. */
  const confidenceOptions = (current?: number): number[] => {
    const options = current == null ? availableConfidences : [...availableConfidences, current];
    return options.sort((a, b) => a - b);
  };

  const setConfidence = (gameId: string, raw: string) => {
    const value = raw === '' ? undefined : Number(raw);
    setDraft(prev => {
      const existing = prev[gameId];
      if (!existing) return prev;

      const next = { ...prev, [gameId]: { ...existing, confidence: value } };

      // Assigning a value that another draft pick holds moves it, rather than
      // creating a duplicate the database would reject at submit time. The
      // selector does not offer such a value, but a stale render could.
      if (value != null) {
        for (const [otherId, other] of Object.entries(prev)) {
          if (otherId !== gameId && other.confidence === value) {
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

  return (
    <section className="mx-auto max-w-3xl pb-24">
      <header className="mb-6">
        <h1 className="font-display text-4xl tracking-wide text-ink">
          Week {week.weekNumber}
        </h1>
        <p className="mt-2 text-muted">
          {totalPicked} of {PICKS_PER_WEEK} picked
          {' · '}
          sheet closes {getTimeUntil(finalLock, now)}
          {lockedPicks.length > 0 && ` · ${lockedPicks.length} already locked in`}
        </p>
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

                {/* The selector only appears once a side is chosen — a
                    confidence with no team attached is not a pick. Options are
                    the values still free for the week PLUS this game's own
                    current value, so re-opening the control does not hide the
                    number already assigned to it. */}
                {entry?.selectedTeamId && (
                  <label className="mt-2 flex items-center gap-2 px-1 text-sm text-muted">
                    Confidence
                    <select
                      className="rounded-control border border-line bg-surface px-2 py-1 text-ink"
                      value={entry.confidence ?? ''}
                      onChange={e => setConfidence(game.id, e.target.value)}
                    >
                      <option value="">—</option>
                      {confidenceOptions(entry.confidence).map(c => (
                        <option key={c} value={c}>
                          {c}
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
          <Button
            size="lg"
            className="w-full"
            isLoading={saving}
            disabled={complete.length === 0}
            onClick={handleSave}
          >
            Save picks
          </Button>
        </div>
      )}
    </section>
  );
};
