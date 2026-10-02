// Pagination contract for data-access functions. UI can add page controls later without touching queries.
export const DEFAULT_LIMIT = 1000; // PostgREST's default max-rows; larger requests are silently cut to this.
export interface Page { limit: number; offset: number }
export const firstPage = (limit = DEFAULT_LIMIT): Page => ({ limit: Math.min(limit, DEFAULT_LIMIT), offset: 0 });
export const rangeOf = (p: Page): [number, number] => [p.offset, p.offset + p.limit - 1];

/** Reads every row of an ordered query in 1000-row chunks. `build` must apply a stable .order(). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, size = 1000, max = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return out;
}
