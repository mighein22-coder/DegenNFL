import { describe, expect, it } from 'vitest';
import { fetchAllRows } from '../pagination';

/** A fake table behind a server that never returns more than `cap` rows. */
function server(total: number, cap: number) {
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, from + cap - 1, total - 1);
    const rows: number[] = [];
    for (let i = from; i <= end; i++) rows.push(i);
    return rows;
  };
  return { fetchPage, calls };
}

describe('fetchAllRows', () => {
  it('returns every row of a table bigger than the page size', async () => {
    const { fetchPage } = server(2350, 1000);
    const rows = await fetchAllRows(fetchPage, 1000);
    expect(rows).toHaveLength(2350);
    expect(rows[0]).toBe(0);
    expect(rows[2349]).toBe(2349);
  });

  it('does not duplicate or skip a row across page boundaries', async () => {
    const { fetchPage } = server(2350, 1000);
    const rows = await fetchAllRows(fetchPage, 1000);
    expect(new Set(rows).size).toBe(2350);
  });

  it('still returns the newest rows of a table just past the cap', async () => {
    // Just over the cap: a single capped read loses the tail.
    const { fetchPage } = server(1040, 1000);
    const single = await fetchPage(0, 999);
    expect(single).toHaveLength(1000);
    const rows = await fetchAllRows(fetchPage, 1000);
    expect(rows).toHaveLength(1040);
    expect(rows[1039]).toBe(1039);
  });

  it('is not fooled by a server whose cap is smaller than the page size', async () => {
    const { fetchPage } = server(2350, 500);
    expect(await fetchAllRows(fetchPage, 1000)).toHaveLength(2350);
  });

  it('handles a table that is an exact multiple of the page size', async () => {
    const { fetchPage, calls } = server(2000, 1000);
    expect(await fetchAllRows(fetchPage, 1000)).toHaveLength(2000);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('handles an empty table and a small one', async () => {
    expect(await fetchAllRows(server(0, 1000).fetchPage)).toEqual([]);
    expect(await fetchAllRows(server(7, 1000).fetchPage)).toHaveLength(7);
  });

  it('lets a failed page throw rather than returning a partial table', async () => {
    let n = 0;
    const flaky = async (from: number) => {
      if (n++ === 1) throw new Error('network');
      return from === 0 ? Array.from({ length: 1000 }, (_, i) => i) : [];
    };
    await expect(fetchAllRows(flaky, 1000)).rejects.toThrow('network');
  });

  it('gives up on a source that never runs dry', async () => {
    await expect(fetchAllRows(async () => [1], 1000, 5)).rejects.toThrow(/5 pages/);
  });
});
