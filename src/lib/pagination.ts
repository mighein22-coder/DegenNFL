/**
 * Read every row of a table through PostgREST's row cap.
 *
 * Supabase's API returns at most 1000 rows per request (`max_rows`), and says
 * nothing when it truncates: a `select('*')` over a bigger table simply comes
 * back 1000 rows long, in no stated order, with no error. A league-wide read of
 * `picks` crosses that line mid-season — a full sheet is five rows a member a
 * week, so about thirty members pass a thousand rows in week 7 — and what falls
 * off the end is the NEWEST rows, which is exactly the part a standings table
 * is for.
 *
 * `fetchPage` takes an inclusive `[from, to]` range, the way `.range()` does.
 * The caller MUST give its query a total order (`.order('id')`): without one,
 * pages can overlap or skip rows between requests.
 *
 * It stops on an EMPTY page rather than a short one. A short page is how a
 * server with a smaller cap than `pageSize` looks too, and treating that as
 * the end would reintroduce the truncation this exists to prevent; the cost is
 * one extra, empty request.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize: number = 1000,
  // A runaway guard, not a limit anyone should meet: 100 pages is 100,000 rows.
  maxPages: number = 100
): Promise<T[]> {
  const all: T[] = [];

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage(all.length, all.length + pageSize - 1);
    if (rows.length === 0) return all;
    all.push(...rows);
  }

  throw new Error(`fetchAllRows: still receiving rows after ${maxPages} pages`);
}
