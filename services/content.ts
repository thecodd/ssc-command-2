import { requireUser } from "@/lib/auth";
import { getClock } from "./profile";
import type { EntityType } from "@/types/curriculum";
import { safeExternalUrl } from "@/lib/url";
const TYPES = ["ncert_chapter", "ssc_topic", "ssc_subtopic"];
export async function addNote(i: { entity_type: EntityType; entity_id: string; title: string | null; content: string }) {
  if (!TYPES.includes(i.entity_type)) throw new Error("Invalid item.");
  const { sb, user } = await requireUser();
  const { error } = await sb.from("notes").insert({ ...i, user_id: user.id });
  if (error) throw error;
}
export async function addResource(i: { entity_type: EntityType; entity_id: string; title: string; url: string | null; type: string; description: string | null }) {
  if (!TYPES.includes(i.entity_type)) throw new Error("Invalid item.");
  if (i.url && !safeExternalUrl(i.url)) throw new Error("Links must start with http:// or https://");
  const { sb, user } = await requireUser();
  const { error } = await sb.from("resources").insert({ ...i, user_id: user.id });
  if (error) throw error;
}
export async function addFocusTask(type: EntityType, id: string, title: string) {
  if (!TYPES.includes(type)) throw new Error("Invalid item.");
  const { sb, user } = await requireUser();
  const { today } = await getClock();
  const { data: ex } = await sb.from("tasks").select("id").eq("user_id", user.id).eq("entity_type", type).eq("entity_id", id).eq("due_date", today).neq("status", "completed").limit(1);
  if (ex?.length) return { already: true };
  const { error } = await sb.from("tasks").insert({ user_id: user.id, title: `Study: ${title}`.slice(0, 160), entity_type: type, entity_id: id, due_date: today, priority: "high", status: "todo" });
  if (error) throw error;
  return { already: false };
}

export async function updateNote(i: { id: string; title: string | null; content: string }) {
  const { sb, user } = await requireUser();
  const { error } = await sb.from("notes").update({ title: i.title, content: i.content }).eq("id", i.id).eq("user_id", user.id);
  if (error) throw error;
}
