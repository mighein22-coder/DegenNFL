import { WEEK_COUNT } from '../constants';
import { parseWeekId } from './timezone';
import type { Segment } from '../types';

/**
 * Season segments.
 *
 * The season is divided into three roughly equal segments, each keeping its own
 * standings alongside the cumulative season table. Segments are *derived* from
 * the week count rather than stored, so there is no table to keep in sync and
 * no backfill when the season length changes.
 *
 * This is markedly simpler than the NHL version, which had to enumerate the
 * calendar Saturdays falling inside two season-bound dates and split those. The
 * NFL's canonical 1..18 means the split is just arithmetic: 18 weeks, three
 * segments, 6 / 6 / 6.
 */

export const SEGMENT_COUNT = 3;

/**
 * Splits the season into three contiguous segments of as-equal length as
 * possible. When the count does not divide evenly the earlier segments absorb
 * the remainder, so sizes never differ by more than one.
 *
 * For an 18-week season:
 *   Segment 1  weeks 1–6
 *   Segment 2  weeks 7–12
 *   Segment 3  weeks 13–18
 */
export function getSegments(weekCount: number = WEEK_COUNT): Segment[] {
  if (weekCount <= 0) return [];

  const base = Math.floor(weekCount / SEGMENT_COUNT);
  const remainder = weekCount % SEGMENT_COUNT;

  const segments: Segment[] = [];
  let cursor = 1;

  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const size = base + (i < remainder ? 1 : 0);
    if (size === 0) continue; // Fewer weeks than segments — skip the empties

    segments.push({
      number: i + 1,
      label: `Segment ${i + 1}`,
      startWeek: cursor,
      endWeek: cursor + size - 1,
      weekCount: size
    });
    cursor += size;
  }

  return segments;
}

/** The segment containing a given week number, or null if out of range. */
export function getSegmentForWeek(
  weekNumber: number,
  segments: Segment[] = getSegments()
): Segment | null {
  return (
    segments.find(s => weekNumber >= s.startWeek && weekNumber <= s.endWeek) ?? null
  );
}

/**
 * The segment for a week id.
 *
 * Week ids are `week-YYYY-NN`, so the week number can be sliced straight out
 * with no database round-trip — which is what lets standings be scoped to a
 * segment from the picks alone, exactly as in the NHL app.
 */
export function getSegmentForWeekId(
  weekId: string,
  segments: Segment[] = getSegments()
): Segment | null {
  const parsed = parseWeekId(weekId);
  return parsed ? getSegmentForWeek(parsed.weekNumber, segments) : null;
}

/** The segment a week sits in, else the last one already begun, else the first. */
export function getCurrentSegment(
  weekNumber: number,
  segments: Segment[] = getSegments()
): Segment | null {
  if (segments.length === 0) return null;
  return (
    getSegmentForWeek(weekNumber, segments) ??
    [...segments].reverse().find(s => weekNumber > s.endWeek) ??
    segments[0]
  );
}
