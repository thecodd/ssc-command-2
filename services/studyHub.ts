import { requireUser } from "@/lib/auth";
import { getAllSignals, getDailyFocus } from "./learning";
import type { EntitySignals, EntityType, FocusItem } from "@/types/curriculum";
export interface HubData { open: { type: EntityType; id: string; title: string; state: "active" | "paused" } | null; focus: FocusItem[]; weak: EntitySignals[]; empty: boolean }
/** Data for /study: resume an open session, today's focus, weak spots. All from the Phase 4 RPCs / real rows. */
export async function getStudyHub(): Promise<HubData> {
  const { sb, user } = await requireUser();
  const [sess, focus, signals] = await Promise.all([
    sb.from("study_sessions").select("entity_type,entity_id,state").eq("user_id", user.id).in("state", ["active", "paused"]).limit(1),
    getDailyFocus(5), getAllSignals(),
  ]);
  if (sess.error) throw sess.error;
  const s = ((sess.data ?? []) as { entity_type: EntityType; entity_id: string; state: "active" | "paused" }[])[0];
  const title = s ? signals.find((x) => x.entity_id === s.entity_id)?.title ?? focus.find((f) => f.entity_id === s.entity_id)?.title ?? "your session" : null;
  const weak = signals.filter((x) => x.mastery === "weak").slice(0, 6);
  return { open: s ? { type: s.entity_type, id: s.entity_id, title: title!, state: s.state } : null, focus, weak, empty: !s && focus.length === 0 && weak.length === 0 };
}
