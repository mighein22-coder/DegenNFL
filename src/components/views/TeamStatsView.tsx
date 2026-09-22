import React, { useCallback, useMemo, useState } from 'react';
import { EmptyNote, ErrorNote, LoadingNote, PageHeader } from '../Page';
import { useLoader } from '../../hooks/useLoader';
import { useNow } from '../../hooks/useNow';
import {
  getAllPicks,
  getGamesForWeeks,
  getProfiles,
  getTeamRecords
} from '../../lib/supabaseService';
import { completedWeekPicks, computeTeamAffinity } from '../../lib/affinity';
import { TEAMS } from '../../constants';
import type { Profile } from '../../lib/supabase';
import type { Game, Pick } from '../../types';

/**
 * Which teams a member backs, and how that has worked out.
 *
 * ANY member, chosen from the selector — the screen started as the signed-in
 * member's own and is now the league's (issue #31). What it shows is unchanged;
 * whose picks feed it is a piece of state.
 *
 * BYE WEEKS ARE WHY THIS IS NOT A TABLE OF 32. Four to six teams are idle every
 * week and each team plays 17 games in 18, so a full-league table would be full
 * of holes that look like missing results. Only teams the member has actually
 * picked get a row: a team never picked has nothing to say about the member,
 * and its absence is the honest rendering.
 *
 * ONLY COMPLETED WEEKS COUNT, and that is what makes the selector safe to
 * offer. Another member's picks become visible a game at a time, so mid-week
 * their season here would be whichever fraction of their sheet has kicked off.
 * `completedWeekPicks` holds the rule and the argument for it; it applies to
 * the signed-in member too, so every member the selector can reach is measured
 * the same way. My History is where the week being played belongs.
 *
 * The team's own W-L comes from the `team-records` function, and its response
 * shape is ESPN's and undocumented — see the TODO at the top of that file. So
 * it is fetched separately and a failure costs the COLUMN, not the page. The
 * affinity numbers are the member's own data and do not depend on it.
 *
 * That record is also unrelated to how the pool scores. NFL games can tie; pool
 * picks cannot, because every spread is hooked to a half point. A tie shows up
 * in the third component of a record here and nowhere else in the app.
 *
 * ONE LOAD COVERS THE LEAGUE. Picks, profiles and games are fetched once and
 * the selector filters in memory, so flicking between members costs nothing —
 * the same shape the Matrix uses for its week selector.
 */

interface TeamStatsViewProps {
  profile: Profile;
}

interface Loaded {
  picks: Pick[];
  games: Game[];
  profiles: Profile[];
  /** Null when the records fetch failed — the column is dropped, not the page. */
  records: Record<string, string> | null;
}

export const TeamStatsView: React.FC<TeamStatsViewProps> = ({ profile }) => {
  const now = useNow();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Loaded> => {
    const [picks, profiles] = await Promise.all([getAllPicks(), getProfiles()]);

    // Every week anyone has a visible pick in, not only the weeks that are
    // over. The completed-week filter is applied at render time against a
    // ticking clock, so a week that finishes while the page is open must not
    // arrive with its games missing.
    const weekIds = [...new Set(picks.map(pick => pick.weekId))];

    const [games, records] = await Promise.all([
      getGamesForWeeks(weekIds),
      getTeamRecords().catch(() => null)
    ]);

    return { picks, games, profiles, records };
  }, []);

  const { data, error, loading, reload } = useLoader(load);

  // The signed-in member unless the selector says otherwise. Falling back to
  // them also covers a selected id that is no longer in the roster, which beats
  // an empty screen headed by a name nobody recognises.
  const member = useMemo(() => {
    if (!data) return profile;
    return (
      (selectedUserId
        ? data.profiles.find(candidate => candidate.id === selectedUserId)
        : null) ??
      data.profiles.find(candidate => candidate.id === profile.id) ??
      profile
    );
  }, [data, selectedUserId, profile]);

  const isSelf = member.id === profile.id;

  // Before the week filter: what this member has visible at all. Its only use
  // is telling 'has never picked' from 'has picked, but nothing has finished
  // yet' in the empty state — two very different things to be told.
  const visible = useMemo(
    () => (data ? data.picks.filter(pick => pick.userId === member.id) : []),
    [data, member.id]
  );

  const counted = useMemo(
    () => (data ? completedWeekPicks(data.picks, member.id, now) : []),
    [data, member.id, now]
  );

  const rows = useMemo(
    () => (data ? computeTeamAffinity(counted, data.games) : []),
    [data, counted]
  );

  const resolved = useMemo(
    () => rows.reduce((sum, row) => sum + row.wins + row.losses, 0),
    [rows]
  );

  const weeksCounted = useMemo(
    () => new Set(counted.map(pick => pick.weekId)).size,
    [counted]
  );

  if (error) {
    return (
      <section className="mx-auto max-w-3xl">
        <PageHeader title="Team Affinity" />
        <ErrorNote
          message="Could not load the league's picks."
          detail={error}
          onRetry={reload}
        />
      </section>
    );
  }

  if (!data) {
    return (
      <section className="mx-auto max-w-3xl">
        <PageHeader title="Team Affinity" />
        {loading && <LoadingNote label="Loading the league…" />}
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl">
      <PageHeader
        title="Team Affinity"
        subtitle={
          rows.length === 0 ? (
            isSelf ? (
              'Which teams you back, and how that has worked out.'
            ) : (
              `Which teams ${member.name} backs, and how that has worked out.`
            )
          ) : (
            <>
              {rows.length} {rows.length === 1 ? 'team' : 'teams'} backed across{' '}
              {counted.length} {counted.length === 1 ? 'pick' : 'picks'}
              {resolved > 0 && `, ${resolved} graded so far`}.
            </>
          )
        }
        actions={
          <label className="flex items-center gap-2 text-sm text-muted">
            Member
            <select
              value={member.id}
              onChange={event => setSelectedUserId(event.target.value)}
              className="rounded-control border border-line bg-surface px-2 py-1.5 text-ink"
            >
              {data.profiles.map(option => (
                <option key={option.id} value={option.id}>
                  {option.id === profile.id ? `${option.name} (you)` : option.name}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {rows.length === 0 ? (
        <EmptyNote>
          {counted.length === 0 && visible.length > 0
            ? // Picks exist, but every one of them is in a week still being
              // played. 'Nothing picked yet' would be wrong here, and to a
              // member reading their own screen it would look like data loss.
              // Guarded on `counted` as well so that a counted pick whose game
              // row is missing — dropped by `computeTeamAffinity` — does not
              // get explained away as a week in progress.
              'Nothing counted yet — every pick so far is in a week that is still being played. A week joins this screen once it is over.'
            : isSelf
              ? 'Nothing to show yet — a team appears here the first time you pick it, once that week has finished.'
              : `Nothing to show yet — no completed week has a pick from ${member.name} on it.`}
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
        {isSelf
          ? 'Only teams you have picked appear.'
          : `Only teams ${member.name} has picked appear.`}{' '}
        Four to six teams are on a bye every week and each plays 17 games in 18,
        so a team missing from this list has not been backed — it is not a gap in
        the data. Cover is wins as a share of the picks already graded, and the
        number in brackets under W-L is the picks still to be graded.{' '}
        {weeksCounted > 0 &&
          `${weeksCounted} completed ${weeksCounted === 1 ? 'week is' : 'weeks are'} counted. `}
        A week counts once it is over — the Tuesday after its Sunday, by which
        point every game in it has been played and scored. The week being played
        is left out for every member alike, because picks on it are revealed a
        game at a time and a part-revealed sheet is not a season.
        {!data.records &&
          ' Team records are unavailable right now, so that column is hidden rather than guessed at.'}
      </p>
    </section>
  );
};
