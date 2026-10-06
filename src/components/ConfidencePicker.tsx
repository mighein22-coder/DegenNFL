import React from 'react';
import { BONUS_POINTS, ORDINARY_POINTS } from '../constants';

/**
 * The phone control for what a pick is worth: two buttons, 1 pt and 3 pts, in
 * place of the native `<select>` (which is a full-screen wheel on iOS and four
 * taps for a two-way choice).
 *
 * Phones only. From `md` up the pick sheet keeps its `<select>`, so the desktop
 * layout does not change, and on paper neither control prints (the sheet
 * prints the value as text).
 *
 * `offered` is what the sheet says the week can still hold, from
 * `pointOptions` in PicksView. A value that is not offered is shown DISABLED
 * and says "used" rather than vanishing: lock the 3 in on Thursday and it is
 * spent for the week, and a lone 1 pt button would not tell a member why the
 * bonus is gone. Tapping the active value again clears it, the same gesture
 * that clears a team.
 */
interface ConfidencePickerProps {
  value?: number;
  offered: number[];
  onChange: (value: number | undefined) => void;
  className?: string;
}

const CHOICES = [ORDINARY_POINTS, BONUS_POINTS] as const;

export const ConfidencePicker: React.FC<ConfidencePickerProps> = ({
  value,
  offered,
  onChange,
  className = ''
}) => (
  <div
    role="radiogroup"
    aria-label="Points for this game"
    className={`flex gap-2 md:hidden print:!hidden ${className}`}
  >
    {CHOICES.map(points => {
      const active = value === points;
      const available = offered.includes(points);
      const label = points === BONUS_POINTS ? '3 pts' : '1 pt';
      return (
        <button
          key={points}
          type="button"
          role="radio"
          aria-checked={active}
          disabled={!available}
          onClick={() => onChange(active ? undefined : points)}
          className={[
            'flex min-h-11 flex-1 items-center justify-center rounded-control border px-3 text-sm font-medium transition-colors',
            active
              ? 'border-brand-400 bg-brand-500 text-white'
              : 'border-line bg-surface text-ink active:bg-surface-raised',
            'disabled:cursor-not-allowed disabled:opacity-50'
          ].join(' ')}
        >
          {label}
          {points === BONUS_POINTS && available && (
            <span className={active ? 'ml-1 text-white/80' : 'ml-1 text-muted'}>· bonus</span>
          )}
          {!available && <span className="ml-1 text-muted">· used</span>}
        </button>
      );
    })}
  </div>
);
