import type { Difficulty, PracticeOptions, PracticeScope, StartRequest } from "@/types/practice";
export const COUNT_CHOICES = [5, 10, 20] as const;
export const DEFAULT_COUNT = 10;
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];
export interface ConfigInput { count?: number; difficulty?: string | null; paper?: string | null }
/** Builds the start request. Only filters the SERVER reported as available can be sent, and the count is clamped to what exists. */
export function buildStartRequest(scope: PracticeScope, scopeId: string | null, opts: PracticeOptions, input: ConfigInput = {}): StartRequest {
  const want = COUNT_CHOICES.includes(input.count as 5) ? (input.count as number) : DEFAULT_COUNT;
  const difficulty = DIFFICULTIES.find((d) => d === input.difficulty && (opts.by_difficulty[d] ?? 0) > 0) ?? null;
  const paper = opts.papers.find((p) => p.id === input.paper)?.id ?? null;
  const pool = paper ? opts.papers.find((p) => p.id === paper)!.n : difficulty ? opts.by_difficulty[difficulty]! : opts.total;
  return { scope, scopeId, count: Math.max(1, Math.min(want, pool || want)), difficulty, paper };
}
/** Which optional filters are worth showing: only ones that would actually change the question set. */
export function availableFilters(o: PracticeOptions) {
  const diffs = DIFFICULTIES.filter((d) => (o.by_difficulty[d] ?? 0) > 0);
  return { difficulties: diffs.length > 1 ? diffs : [], papers: o.papers.length > 1 ? o.papers : [], counts: COUNT_CHOICES.filter((c) => c < o.total) };
}
