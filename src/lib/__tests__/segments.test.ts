import { describe, it, expect } from 'vitest';
import {
  getSegments,
  getSegmentForWeek,
  getSegmentForWeekId,
  getCurrentSegment,
  SEGMENT_COUNT
} from '../segments';
import { WEEK_COUNT } from '../../constants';

describe('getSegments', () => {
  it('splits an 18-week season into three sixes', () => {
    expect(getSegments(18)).toEqual([
      { number: 1, label: 'Segment 1', startWeek: 1, endWeek: 6, weekCount: 6 },
      { number: 2, label: 'Segment 2', startWeek: 7, endWeek: 12, weekCount: 6 },
      { number: 3, label: 'Segment 3', startWeek: 13, endWeek: 18, weekCount: 6 }
    ]);
  });

  it('gives the remainder to the earlier segments', () => {
    // 17 weeks → 6 / 6 / 5
    expect(getSegments(17).map(s => s.weekCount)).toEqual([6, 6, 5]);
    // 16 weeks → 6 / 5 / 5
    expect(getSegments(16).map(s => s.weekCount)).toEqual([6, 5, 5]);
  });

  it('covers every week with no gap and no overlap', () => {
    const segments = getSegments(WEEK_COUNT);
    expect(segments[0].startWeek).toBe(1);
    expect(segments[segments.length - 1].endWeek).toBe(WEEK_COUNT);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startWeek).toBe(segments[i - 1].endWeek + 1);
    }
  });

  it('skips empty segments when there are fewer weeks than segments', () => {
    expect(getSegments(2)).toHaveLength(2);
    expect(getSegments(0)).toEqual([]);
  });

  it('produces at most SEGMENT_COUNT segments', () => {
    expect(getSegments(WEEK_COUNT)).toHaveLength(SEGMENT_COUNT);
  });
});

describe('getSegmentForWeek', () => {
  it('places weeks in the right third', () => {
    expect(getSegmentForWeek(1)?.number).toBe(1);
    expect(getSegmentForWeek(6)?.number).toBe(1);
    expect(getSegmentForWeek(7)?.number).toBe(2);
    expect(getSegmentForWeek(12)?.number).toBe(2);
    expect(getSegmentForWeek(13)?.number).toBe(3);
    expect(getSegmentForWeek(18)?.number).toBe(3);
  });

  it('returns null outside the season', () => {
    expect(getSegmentForWeek(0)).toBeNull();
    expect(getSegmentForWeek(19)).toBeNull();
  });
});

describe('getSegmentForWeekId', () => {
  it('slices the week number out of the id without a round-trip', () => {
    expect(getSegmentForWeekId('week-2026-01')?.number).toBe(1);
    expect(getSegmentForWeekId('week-2026-08')?.number).toBe(2);
    expect(getSegmentForWeekId('week-2026-18')?.number).toBe(3);
  });

  it('returns null for a malformed id', () => {
    expect(getSegmentForWeekId('week-2026-19')).toBeNull();
    expect(getSegmentForWeekId('week-2026-10-11')).toBeNull();
    expect(getSegmentForWeekId('')).toBeNull();
  });
});

describe('getCurrentSegment', () => {
  it('returns the segment containing the week', () => {
    expect(getCurrentSegment(9)?.number).toBe(2);
  });

  it('falls back to the last segment begun once past the season', () => {
    expect(getCurrentSegment(25)?.number).toBe(3);
  });

  it('falls back to the first segment before the season', () => {
    expect(getCurrentSegment(0)?.number).toBe(1);
  });
});
