/**
 * Supabase caps a single REST read at 1000 rows (the project's "Max rows"
 * setting). A sheet with a few thousand requirement lines therefore comes back
 * silently truncated — no error, just missing data, which shows up downstream
 * as quantities that don't add up.
 *
 * `fetchAll` pages through the whole result set instead.
 *
 * The builder MUST apply a stable `.order(...)` on a column (or columns) that
 * uniquely identifies a row. Without a total ordering, Postgres is free to
 * return rows in a different order per page, which makes pagination skip and
 * duplicate rows rather than fixing anything.
 */
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const batch = data ?? [];
    rows.push(...batch);

    // A short page means we've reached the end.
    if (batch.length < PAGE_SIZE) return rows;
  }
}
