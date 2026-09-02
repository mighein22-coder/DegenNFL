import React, { useCallback, useMemo } from 'react';
import { EmptyNote, ErrorNote, LoadingNote, PageHeader } from '../Page';
import { useLoader } from '../../hooks/useLoader';
import {
  getAllPicks,
  getGamesForWeeks,
  getTeamRecords
} from '../../lib/supabaseService';
import { computeTeamAffinity } from '../../lib/affinity';
import { TEAMS } from '../../constants';
import type { Profile } from '../../lib/supabase';
import type { Game, Pick } from '../../types';

/**
 * Which teams the member backs, and how that has worked out.
 *
 * BYE WEEKS ARE WHY THIS IS NOT A TABLE OF 32. Four to six teams are idle every
 * week and each team plays 17 games in 18, so a full-league table would be full
 * of holes that look like missing results. Only teams the member has actually
 * picked get a row: a team never picked has nothing to say about the member,
 * and its absence is the honest rendering.
 *
 * The team's own W-L comes from the `team-records` function, and its response
 * shape is ESPN's and undocumented — see the TODO at the top of that file. So
 * it is fetched separately and a failure costs the COLUMN, not the page. The
 * affinity numbers are the member's own data and do not depend on it.
 *
 * That record is also unrelated to how the pool scores. NFL games can tie; pool
 * picks cannot, because every spread is hooked to a half point. A tie shows up
 * in the third component of a record here and nowhere else in the app.
 */

interface TeamStatsViewProps {
  profile: Profile;
}

interface Loaded {
  picks: Pick[];
  games: Game[];
  /** Null when the records fetch failed — the column is dropped, not the page. */
  records: Record<string, string> | null;
}

export const TeamStatsView: React.FC<TeamStatsViewProps> = ({ profile }) => {
  const load = useCallback(async (): Promise<Loaded> => {
    const all = await getAllPicks();
    const picks = all.filter(pick => pick.userId === profile.id);
    const weekIds = [...new Set(picks.map(pick => pick.weekId))];

    const [games, records] = await Promise.all([
      getGamesForWeeks(weekIds),
      getTeamRecords().catch(() => null)
    ]);

    return { picks, games, records };
  }, [profile.id]);

  const { data, error, loading, reload } = useLoader(load);

  const rows = useMemo(
    () => (data ? computeTeamAffinity(data.picks, data.games) : []),
    [data]
  );

  const resolved = useMemo(
    () => rows.reduce((sum, row) => sum + row.wins + row.losses, 0),
    [rows]
  );

  if (error) {
    return (
      <section className="mx-auto max-w-3xl">
        <PageHeader title="Team Affinity" />
        <ErrorNote message="Could not load your picks." detail={error} onRetry={reload} />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mx-auto max-w-3xl">
        <PageHeader title="Team Affinity" />
        {loading && <LoadingNote label="Loading your picks…" />}
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl">
      <PageHeader
        title="Team Affinity"
        subtitle={
          rows.length === 0 ? (
            'Which teams you back, and how that has worked out.'
          ) : (
            <>
              {rows.length} {rows.length === 1 ? 'team' : 'teams'} backed across{' '}
              {data.picks.length} {data.picks.length === 1 ? 'pick' : 'picks'}
              {resolved > 0 && `, ${resolved} graded so far`}.
            </>
          )
        }
      />

      {rows.length === 0 ? (
        <EmptyNote>
          Nothing to show yet — a team appears here the first time you pick it.
        </EmptyNote>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full min-w-[26rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-faint">
                <th scope="col" className="py-2 pl-3 pr-3 font-normal">
                  Team
                </th>
                {data.records && (
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Record
                  </th>
                )}
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Picked
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  W-L
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Cover
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-normal">
                  Pts
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const team = TEAMS[row.teamId];
                return (
                  <tr key={row.teamId} className="border-t border-line">
                    <td className="py-2.5 pl-3 pr-3">
                      <span className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="h-6 w-1.5 shrink-0 rounded-full"
                          // The club's own colour, not a design token — see constants.ts.
                          style={{ backgroundColor: team?.logoColor ?? 'transparent' }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-ink">
                            {team ? `${team.city} ${team.name}` : row.teamId}
                          </span>
                        </span>
                      </span>
                    </td>

                    {data.records && (
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted">
                        {data.records[row.teamId] ?? '—'}
                      </td>
                    )}

                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-ink">
                      {row.picked}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-muted">
                      {row.wins}-{row.losses}
                      {row.pending > 0 && (
                        <span className="text-faint"> (+{row.pending})</span>
                      )}
                    </td>
                    <td
                      className={[
                        'py-2.5 pr-3 text-right font-mono tabular-nums',
                        row.winRate == null
                          ? 'text-faint'
                          : row.winRate > 0.5
                            ? 'text-win'
                            : row.winRate < 0.5
                              ? 'text-loss'
                              : 'text-muted'
                      ].join(' ')}
                    >
                      {row.winRate == null ? '—' : `${Math.round(row.winRate * 100)}%`}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-ink">
                      {row.points}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-faint">
        Only teams you have picked appear. Four to six teams are on a bye every
        week and each plays 17 games in 18, so a team missing from this list has
        not been backed — it is not a gap in the data. Cover is wins as a share
        of the picks already graded, and the number in brackets under W-L is the
        picks still to be graded.
        {!data.records &&
          ' Team records are unavailable right now, so that column is hidden rather than guessed at.'}
      </p>
    </section>
  );
};
