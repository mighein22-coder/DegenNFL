import React, { useMemo, useState } from 'react';
import { Button } from '../Button';
import { GameCard } from '../GameCard';
import { PrintButton } from '../PrintButton';
import {
  PICKS_PER_WEEK,
  ORDINARY_POINTS,
  BONUS_POINTS,
  BONUS_PICKS_PER_WEEK,
  ORDINARY_PICKS_PER_WEEK
} from '../../constants';
import {
  isPickLocked,
  getFinalLockAt,
  getTimeUntil,
  formatETTime
} from '../../lib/timezone';
import { sheetHasChanges } from '../../lib/sheet';
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
 *   * An EMPTY sheet is a normal state too. save_picks replaces every unlocked
 *     row with what it is sent, so a pick left out is a pick deleted, and a
 *     member who unselects everything is asking for exactly that. The save
 *     button therefore turns on when the sheet has CHANGED, not when it holds
 *     something — see `sheetHasChanges`.
 *
 * The consequence for this component: what is still assignable is derived from
 * locked picks plus current draft selections TOGETHER, never from the draft
 * alone. Getting that wrong is how a member ends up unable to submit.
 *
 * Only the bonus needs the 'move it rather than duplicate it' behaviour below.
 * Ordinary picks are interchangeable, so there is nothing to move — they are
 * only ever capped.
 *
 * ON PAPER this screen is a RECORD OF WHAT WAS SUBMITTED, not a blank sheet to
 * fill in by hand. Three things follow from that and each is a `print:` rule
 * below rather than a second component:
 *
 *   * The WHOLE week prints, open games and locked ones alike, including games
 *     with no pick on them — a record that silently omits the three games you
 *     never got to is not a record of your week.
 *   * Every control becomes the value it holds. The confidence `<select>`
 *     prints as "3 pts — bonus"; the save buttons do not print at all.
 *   * An unsaved sheet says so. The draft lives in this component, so a member
 *     can print five picks the pool has never seen, and paper outlives the tab
 *     it came from — the banner is the only thing standing between that and a
 *     dispute in week 14.
 */

interface PicksViewProps {
  week: Week;
  games: Game[];
  /**
   * The signed-in member's existing picks for this week, and ONLY theirs.
   *
   * Everything below reads this as "mine": the locked-in count, which point
   * values are still spendable, and which team a locked card draws. Passing a
   * league-wide read here does not degrade gracefully — it inflates the count
   * past five, hides values another member spent, and shows their pick as
   * yours. `getMyPicksForWeek` takes a user id for this reason.
   */
  myPicks: Pick[];
  /** Whose sheet this is. Printed; a sheet on paper with no name on it is anonymous. */
  memberName: string;
  /**
   * Team abbreviation -> "W-L", shown in parentheses on each card (issue #33).
   *
   * Passed straight through to `GameCard`. Null when the records fetch failed,
   * which costs the parenthetical and nothing else — this screen is the one
   * that must keep working when ESPN does not.
   */
  records?: Record<string, string> | null;
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
  memberName,
  records,
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

  // What the draft is measured against when deciding whether there is anything
  // to save: the stored picks the draft can still change. Locked ones are never
  // submitted, so including them here would read as a change that never clears.
  const savedOpenPicks = useMemo(
    () => myPicks.filter(p => !lockedByGameId.get(p.gameId)),
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

  // The sheet as it would be sent. Only the unlocked picks are here: save_picks
  // preserves the locked ones, so omitting them is correct rather than a
  // deletion. An UNLOCKED pick left out, by contrast, IS a deletion — which is
  // what makes an empty submission meaningful and worth offering.
  const submission: PickSubmission[] = complete.map(([gameId, d]) => ({
    gameId,
    selectedTeamId: d.selectedTeamId,
    confidence: d.confidence!
  }));

  const dirty = sheetHasChanges(savedOpenPicks, submission);

  const handleSave = () => {
    onSave(submission);
  };

  const finalLock = getFinalLockAt(week.weekNumber);
  const openGames = games.filter(g => !lockedByGameId.get(g.id));
  const closedGames = games.filter(g => lockedByGameId.get(g.id));

  // One control, rendered twice — beside the header and again at the foot of
  // the sheet, so a long week is never a scroll away from saving. Built here
  // rather than written out twice: the two must never disagree about whether
  // the sheet is saveable, or one of them lies about it.
  //
  // Live when the sheet has CHANGED, not when it merely holds a pick. The
  // earlier emptiness test made removing a member's last unlocked pick
  // impossible: unselecting it emptied the draft and greyed the button out
  // with the deletion stranded on the client.
  const saveButton = (size: 'md' | 'lg', className: string) => (
    <Button
      size={size}
      className={className}
      isLoading={saving}
      disabled={!dirty}
      onClick={handleSave}
    >
      Save picks
    </Button>
  );

  return (
    <section className="mx-auto max-w-3xl pb-24 print:max-w-none print:pb-0">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-4xl tracking-wide text-ink">
            Week {week.weekNumber}
          </h1>

          {/* Print only. The screen knows whose sheet this is because the
              member is signed in looking at it; a sheet of paper does not, and
              these come out of the printer in a stack. */}
          <p className="mt-1 hidden text-sm text-muted print:block">
            {memberName} · printed {formatETTime(now, 'EEE d MMM, h:mm a zzz')}
          </p>
          <p className="mt-2 text-muted">
            {totalPicked} of {PICKS_PER_WEEK} picked
            {/* This count includes selections that are only on screen, so on
                its own it cannot be read as "my sheet is in". Saying so is the
                difference between a member who knows their save was rejected
                and one who reads 5 of 5 over an empty row in the Matrix. */}
            {dirty && <span className="text-loss"> · not saved yet</span>}
            {' · '}
            {spent.bonus > 0 ? 'bonus set' : 'bonus not set'}
            {' · '}
            sheet closes {getTimeUntil(finalLock, now)}
            {lockedPicks.length > 0 && ` · ${lockedPicks.length} already locked in`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <PrintButton label="Print sheet" />
          {openGames.length > 0 && saveButton('md', 'print:hidden')}
        </div>
      </header>

      {/* The loudest thing on the printed page when it applies, and absent
          otherwise. `dirty` means the draft on screen differs from what
          save_picks holds, so this paper would be evidence of a sheet that was
          never submitted. */}
      {dirty && (
        <p className="mb-6 hidden break-inside-avoid border border-loss p-3 text-sm text-loss print:block">
          These picks have NOT been saved. This is what was on screen when it
          was printed, not what the pool has recorded.
        </p>
      )}

      {openGames.length > 0 && (
        <div className="mb-8 space-y-3">
          <h2 className="font-display text-xl tracking-wide text-muted">Open</h2>
          {openGames.map(game => {
            const entry = draft[game.id];
            return (
              /* The card and the value assigned to it are one thing and must
                 not be split by a page break — a printed game whose "Worth 3
                 pts" landed on the next sheet reads as an unscored pick. */
              <div key={game.id} className="break-inside-avoid">
                <GameCard
                  game={game}
                  selectedTeamId={entry?.selectedTeamId}
                  confidence={entry?.confidence}
                  locked={false}
                  records={records}
                  onSelectTeam={teamId => selectTeam(game.id, teamId)}
                />

                {/* The selector only appears once a side is chosen — points
                    with no team attached are not a pick. */}
                {entry?.selectedTeamId ? (
                  <label className="mt-2 flex items-center gap-2 px-1 text-sm text-muted print:font-bold">
                    Worth
                    <select
                      className="rounded-control border border-line bg-surface px-2 py-1 text-ink print:hidden"
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

                    {/* A dropdown prints as a dropdown: a box with a value in
                        it and an arrow the reader cannot use. On paper it is
                        just the value. */}
                    <span className="hidden text-ink print:inline">
                      {entry.confidence === BONUS_POINTS
                        ? '3 pts — bonus'
                        : entry.confidence === ORDINARY_POINTS
                          ? '1 pt'
                          : 'not set'}
                    </span>

                    {entry.confidence == null && (
                      <span className="text-faint">not counted until set</span>
                    )}
                  </label>
                ) : (
                  /* Print only. A game left alone is part of the record — on
                     screen the empty card says so plainly enough, but on paper
                     a silent gap and a forgotten pick look identical. */
                  <p className="mt-2 hidden px-1 text-sm font-bold text-faint print:block">
                    No pick.
                  </p>
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
              <div key={game.id} className="break-inside-avoid">
                <GameCard
                  game={game}
                  selectedTeamId={pick?.selectedTeamId}
                  confidence={pick?.confidence}
                  locked
                  records={records}
                />

                {/* Same reason as the open section: on the printed record a
                    game that closed with nothing on it has to say so. */}
                {!pick && (
                  <p className="mt-2 hidden px-1 text-sm font-bold text-faint print:block">
                    No pick — this game closed without one.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openGames.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface-sunken p-4 md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 print:!hidden">
          {saveButton('lg', 'w-full')}
        </div>
      )}
    </section>
  );
};
