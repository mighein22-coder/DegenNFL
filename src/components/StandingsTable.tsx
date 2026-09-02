import React from 'react';
import { MemberAvatar } from './MemberAvatar';
import type { StandingsRow } from '../types';

/**
 * The standings table, shared by the Standings screen and the Dashboard's
 * shoulder-check of the top few.
 *
 * Ranks are rendered exactly as `rankStandings` assigned them — competition
 * ranks, so a tie reads 1, 2, 2, 4. Never renumber from the array index here:
 * that is what turns two members level on points into a first and a second.
 */
interface StandingsTableProps {
  rows: StandingsRow[];
  /** The signed-in member, whose row is marked. */
  highlightUserId?: string;
  /**
   * Show only this many rows. The highlighted member is appended below the cut
   * when they fall outside it — a table that silently omits the person reading
   * it is the one thing they came to check.
   */
  limit?: number;
  /** Drops the season and weekly columns, for the narrower Dashboard panel. */
  compact?: boolean;
  /** Names the week the `weeklyScore` column covers, when there is one. */
  weeklyLabel?: string;
}

export const StandingsTable: React.FC<StandingsTableProps> = ({
  rows,
  highlightUserId,
  limit,
  compact = false,
  weeklyLabel
}) => {
  const shown = limit == null ? rows : rows.slice(0, limit);
  const mine = rows.find(row => row.userId === highlightUserId);
  const mineIsCut = mine != null && !shown.some(row => row.userId === mine.userId);

  const renderRow = (row: StandingsRow, detached: boolean) => (
    <tr
      key={row.userId}
      className={[
        'border-t border-line',
        detached ? 'border-t-2' : '',
        row.userId === highlightUserId ? 'bg-brand-900/30' : ''
      ].join(' ')}
    >
      <td className="py-2.5 pl-3 pr-2 font-mono tabular-nums text-muted">{row.rank}</td>
      <td className="py-2.5 pr-3">
        <span className="flex items-center gap-2.5">
          <MemberAvatar name={row.name} avatar={row.avatar} size="sm" />
          <span className="truncate text-ink">{row.name}</span>
        </span>
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-ink">
        {row.totalPoints}
      </td>
      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted">
        {row.wins}-{row.losses}
      </td>
      {!compact && (
        <>
          <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted">
            {row.seasonPoints}
          </td>
          <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted">
            {row.weeklyScore}
          </td>
        </>
      )}
    </tr>
  );

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <table className="w-full min-w-[22rem] text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-faint">
            <th scope="col" className="py-2 pl-3 pr-2 font-normal">
              #
            </th>
            <th scope="col" className="py-2 pr-3 font-normal">
              Member
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-normal">
              Pts
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-normal">
              W-L
            </th>
            {!compact && (
              <>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Season
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  {weeklyLabel ?? 'Week'}
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {shown.map(row => renderRow(row, false))}
          {mineIsCut && mine && renderRow(mine, true)}
        </tbody>
      </table>
    </div>
  );
};
