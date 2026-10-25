import { describe, expect, it } from 'vitest';
import { fetchAllPages } from '../paging';

/** A fake `.range()` over `total` rows, recording each request. */
function table(total: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    return rows.slice(from, to + 1);
  };
  return { rows, calls, fetchPage };
}

describe('fetchAllPages', () => {
  it('reads past the first page instead of stopping at the cap', async () => {
    const { rows, calls, fetchPage } = table(2350);
    expect(await fetchAllPages(fetchPage, 1000)).toEqual(rows);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999]
    ]);
  });

  it('makes one extra request when the table is an exact multiple of the page', async () => {
    const { rows, calls, fetchPage } = table(2000);
    expect(await fetchAllPages(fetchPage, 1000)).toEqual(rows);
    expect(calls).toHaveLength(3);
  });

  it('returns a short table in one request', async () => {
    const { rows, calls, fetchPage } = table(7);
    expect(await fetchAllPages(fetchPage, 1000)).toEqual(rows);
    expect(calls).toEqual([[0, 999]]);
  });

  it('returns an empty table as empty', async () => {
    const { fetchPage } = table(0);
    expect(await fetchAllPages(fetchPage, 1000)).toEqual([]);
  });

  it('propagates a failed page rather than returning a partial read', async () => {
    let n = 0;
    const fetchPage = async () => {
      if (n++ === 1) throw new Error('boom');
      return Array.from({ length: 10 }, () => 0);
    };
    await expect(fetchAllPages(fetchPage, 10)).rejects.toThrow('boom');
  });
});
