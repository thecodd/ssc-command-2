import { getUser, requireUser } from "@/lib/auth";
import type { DashboardSummary, EntitySignals, EntityType, FocusItem } from "@/types/curriculum";
// The only readers of derived learning state. Everything (mastery, weak, focus, dashboard numbers) is computed by SQL (010).
export async function getEntitySignals(type: EntityType, id: string): Promise<EntitySignals | null> {
  const { sb } = await requireUser();
  const { data, error } = await sb.rpc("user_entity_signals", { p_type: type, p_id: id });
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as EntitySignals | undefined) ?? null;
}
export async function getAllSignals(type?: EntityType): Promise<EntitySignals[]> {
  const { sb } = await requireUser();
  const { data, error } = await sb.rpc("user_entity_signals", { p_type: type ?? null, p_id: null });
  if (error) throw new Error(error.message);
  return (data ?? []) as EntitySignals[];
}
export async function getDailyFocus(limit?: number): Promise<FocusItem[]> {
  const { sb } = await getUser();
  const { data, error } = await sb.rpc("daily_focus", { p_limit: limit ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as FocusItem[];
}
export async function getDashboardSummary(): Promise<DashboardSummary | null> {
  const { sb } = await getUser();
  const { data, error } = await sb.rpc("dashboard_summary");
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as DashboardSummary | undefined) ?? null;
}
