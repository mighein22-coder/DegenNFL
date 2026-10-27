/**
 * Reads every row of a query, one page at a time.
 *
 * The Supabase REST API caps a response at the project's "Max rows" setting
 * (1000 by default) and says nothing when it does: the result is simply short,
 * with no error. A pool of twenty members passes 1000 picks around week 10, so
 * a single unpaged read of `picks` would quietly drop the newest rows from
 * Standings, the Matrix and every screen built on them. Raising the cap in the
 * dashboard only moves the limit, and nothing in the repo would record it.
 *
 * `fetchPage(from, to)` must return rows `from`..`to` INCLUSIVE (the shape of
 * PostgREST's `.range()`) from a query with a stable, unique `order`, or rows
 * can repeat or go missing between pages. A page shorter than `pageSize` is the
 * last one. `pageSize` must not exceed the server cap, or a full page would
 * look short and end the read early.
 */
export const PAGE_SIZE = 1000;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize: number = PAGE_SIZE
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
