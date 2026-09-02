import React, { useCallback, useMemo, useState } from 'react';
import { ErrorNote, LoadingNote, PageHeader } from '../Page';
import { StandingsTable } from '../StandingsTable';
import { useLoader } from '../../hooks/useLoader';
import { getAllPicks, getProfiles } from '../../lib/supabaseService';
import { computeStandings, mostRecentScoredWeekId } from '../../lib/standings';
import { getSegments } from '../../lib/segments';
import { parseWeekId } from '../../lib/timezone';
import { FULL_SEASON_LABEL } from '../../constants';
import type { Profile } from '../../lib/supabase';
import type { Pick } from '../../types';

/**
 * Season and per-segment standings.
 *
 * ONE FETCH, FOUR TABLES. `computeStandings` is pure and takes a scope, so the
 * season table and each of the three segments are all derived from the same two
 * reads — switching scope is a re-render, not a round trip. At pool scale
 * (~20 members x 18 weeks x 5 picks) that is a couple of thousand rows, which
 * is why this is worth doing in the client rather than as a view in Postgres.
 *
 * A member with no picks in the selected segment still appears, at zero. They
 * are behind, not absent, and dropping them would quietly shrink the table
 * every time a new segment starts.
 *
 * What is NOT here is any renumbering. `rankStandings` assigns competition
 * ranks — 1, 2, 2, 4 — and the table renders them as given.
 */

interface StandingsViewProps {
  profile: Profile;
}

interface Loaded {
  profiles: Profile[];
  picks: Pick[];
}

export const StandingsView: React.FC<StandingsViewProps> = ({ profile }) => {
  const [segment, setSegment] = useState<number | null>(null);

  const load = useCallback(async (): Promise<Loaded> => {
    const [profiles, picks] = await Promise.all([getProfiles(), getAllPicks()]);
    return { profiles, picks };
  }, []);

  const { data, error, loading, reload } = useLoader(load);

  const segments = useMemo(() => getSegments(), []);

  const rows = useMemo(
    () => (data ? computeStandings(data.profiles, data.picks, { segment }) : []),
    [data, segment]
  );

  const weeklyLabel = useMemo(() => {
    if (!data) return undefined;
    const weekId = mostRecentScoredWeekId(data.picks);
    const parsed = weekId ? parseWeekId(weekId) : null;
    return parsed ? `Wk ${parsed.weekNumber}` : undefined;
  }, [data]);

  const scopeLabel =
    segment == null
      ? FULL_SEASON_LABEL
      : (segments.find(s => s.number === segment)?.label ?? FULL_SEASON_LABEL);

  const scopeRange =
    segment == null
      ? 'every week played so far'
      : (() => {
          const found = segments.find(s => s.number === segment);
          return found ? `weeks ${found.startWeek}–${found.endWeek}` : '';
        })();

  const tab = (label: string, value: number | null) => (
    <button
      key={label}
      type="button"
      onClick={() => setSegment(value)}
      className={[
        'rounded-control border px-3 py-1.5 text-sm transition-colors',
        segment === value
          ? 'border-brand-400 bg-brand-900/40 text-ink'
          : 'border-line bg-surface text-muted hover:bg-surface-raised hover:text-ink'
      ].join(' ')}
    >
      {label}
    </button>
  );

  return (
    <section className="mx-auto max-w-4xl">
      <PageHeader
        title="Standings"
        subtitle={
          <>
            {scopeLabel} — points, wins and rank over {scopeRange}. Season points
            are shown alongside in every scope.
          </>
        }
        actions={
          <>
            {tab(FULL_SEASON_LABEL, null)}
            {segments.map(s => tab(s.label, s.number))}
          </>
        }
      />

      {error && (
        <ErrorNote
          message="Could not load the standings."
          detail={error}
          onRetry={reload}
        />
      )}

      {!error && !data && loading && <LoadingNote label="Loading the table…" />}

      {!error && data && (
        <>
          <StandingsTable
            rows={rows}
            highlightUserId={profile.id}
            weeklyLabel={weeklyLabel}
          />
          <p className="mt-3 text-xs text-faint">
            Ties are shared ranks: two members level on points and wins are both
            second, and the next member is fourth. Points break first, then wins
            — the same points from more correct picks means the confidence was
            spread better.
          </p>
        </>
      )}
    </section>
  );
};
