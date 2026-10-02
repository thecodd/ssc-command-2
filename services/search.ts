import { getDb } from "@/lib/auth";
export interface SearchHit { kind: string; id: string; title: string; subtitle: string | null; href: string }
export async function searchAll(q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const { data, error } = await getDb().rpc("global_search", { q: term.slice(0, 80), lim: 5 });
  if (error) throw error;
  return (data ?? []) as SearchHit[];
}
