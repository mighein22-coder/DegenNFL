import React from 'react';
import { BONUS_POINTS, ORDINARY_POINTS } from '../constants';
import type { Pick } from '../types';

/**
 * One pick, rendered small: the side taken, what it was worth, how it went.
 *
 * Used by the matrix grid, the history list and the dashboard sheet, so the
 * three cannot drift on what a 3-pointer or a losing pick looks like.
 *
 * Colour carries the result and is never the only carrier of it — the points
 * are written out, and a loss reads "0" whatever a member can see of the hue.
 * There are only ever two resolved states here; a hooked spread means no pick
 * can land on the number, so there is no push to render.
 */
interface PickChipProps {
  pick: Pick;
  /** The team abbreviation to show. Defaults to the picked team's id. */
  label?: string;
  className?: string;
}

export const PickChip: React.FC<PickChipProps> = ({ pick, label, className = '' }) => {
  const tone =
    pick.result === 'WIN'
      ? 'border-win/60 text-win'
      : pick.result === 'LOSS'
        ? 'border-loss/60 text-loss'
        : 'border-line text-muted';

  const isBonus = pick.confidence === BONUS_POINTS;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-xs ${tone} ${className}`}
      title={
        pick.result === 'PENDING'
          ? `${label ?? pick.selectedTeamId} for ${pick.confidence} — not yet graded`
          : `${label ?? pick.selectedTeamId} for ${pick.confidence} — ${pick.result.toLowerCase()}, ${pick.pointsEarned} earned`
      }
    >
      <span className="font-display text-sm leading-none tracking-wide">
        {label ?? pick.selectedTeamId}
      </span>
      <span className={`font-mono tabular-nums ${isBonus ? 'text-ink' : 'text-faint'}`}>
        {isBonus ? `×${BONUS_POINTS}` : `×${ORDINARY_POINTS}`}
      </span>
      <span className="font-mono tabular-nums">
        {pick.result === 'PENDING' ? '·' : pick.pointsEarned}
      </span>
    </span>
  );
};
