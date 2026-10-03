import { requireUser, type Db } from "@/lib/auth";
import { first } from "@/lib/format";
import { getClock } from "./profile";
import type { EntityType } from "@/types/curriculum";

// Tasks, notes and resources: the learner's own workspace. All reads/writes are the user's own rows (RLS: own rows; official resources have user_id null and are read-only).
export const LINKABLE: EntityType[] = ["ncert_chapter", "ssc_topic", "ssc_subtopic"];
export interface LinkRef { type: EntityType; id: string; title: string; href: string }
export interface TaskRow { id: string; title: string; description: string | null; priority: string; due_date: string | null; status: "todo" | "in_progress" | "completed"; completed_at: string | null; link: LinkRef | null }
export interface NoteRow { id: string; title: string | null; content: string; updated_at: string; link: LinkRef | null }
export interface ResourceRow { id: string; title: string; url: string | null; type: string; description: string | null; official: boolean; link: LinkRef | null }

const studyHref = (t: EntityType, id: string) => `/study/${t}/${id}`;
/** Titles for linked entities, in three bounded queries (no N+1). Unknown/archived ids simply get no link. */
export async function resolveLinks(sb: Db, refs: { type: string | null; id: string | null }[]): Promise<Map<string, LinkRef>> {
  const out = new Map<string, LinkRef>(); const by = (t: EntityType) => Array.from(new Set(refs.filter((r) => r.type === t && r.id).map((r) => r.id as string))).slice(0, 200);
  const [ch, tp, st] = await Promise.all([
    by("ncert_chapter").length ? sb.from("chapters").select("id,title").in("id", by("ncert_chapter")) : null,
    by("ssc_topic").length ? sb.from("ssc_topics").select("id,title").in("id", by("ssc_topic")) : null,
    by("ssc_subtopic").length ? sb.from("ssc_subtopics").select("id,title").in("id", by("ssc_subtopic")) : null,
  ]);
  const put = (t: EntityType, rows: { id: string; title: string }[] | null | undefined) => (rows ?? []).forEach((r) => out.set(`${t}:${r.id}`, { type: t, id: r.id, title: r.title, href: studyHref(t, r.id) }));
  put("ncert_chapter", ch?.data as { id: string; title: string }[]); put("ssc_topic", tp?.data as { id: string; title: string }[]); put("ssc_subtopic", st?.data as { id: string; title: string }[]);
  return out;
}
const linkOf = (m: Map<string, LinkRef>, t: string | null, id: string | null) => (t && id ? m.get(`${t}:${id}`) ?? null : null);

// ---------------- tasks ----------------
export async function listTasks(): Promise<{ today: string; open: TaskRow[]; done: TaskRow[] }> {
  const { sb, user } = await requireUser(); const { today } = await getClock();
  const [open, done] = await Promise.all([
    sb.from("tasks").select("id,title,description,priority,due_date,status,completed_at,entity_type,entity_id").eq("user_id", user.id).neq("status", "completed").order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(200),
    sb.from("tasks").select("id,title,description,priority,due_date,status,completed_at,entity_type,entity_id").eq("user_id", user.id).eq("status", "completed").order("completed_at", { ascending: false, nullsFirst: false }).limit(20),
  ]);
  if (open.error) throw open.error; if (done.error) throw done.error;
  type R = Omit<TaskRow, "link"> & { entity_type: string | null; entity_id: string | null };
  const rows = [...(open.data ?? []), ...(done.data ?? [])] as R[]; const links = await resolveLinks(sb, rows.map((r) => ({ type: r.entity_type, id: r.entity_id })));
  const map = (r: R): TaskRow => ({ id: r.id, title: r.title, description: r.description, priority: r.priority, due_date: r.due_date, status: r.status, completed_at: r.completed_at, link: linkOf(links, r.entity_type, r.entity_id) });
  return { today, open: ((open.data ?? []) as R[]).map(map), done: ((done.data ?? []) as R[]).map(map) };
}
export async function createTask(i: { title: string; description: string | null; due_date: string | null; priority: string; link: { type: EntityType; id: string } | null }) {
  const { sb, user } = await requireUser();
  const { error } = await sb.from("tasks").insert({ user_id: user.id, title: i.title, description: i.description, due_date: i.due_date, priority: i.priority, status: "todo", entity_type: i.link?.type ?? null, entity_id: i.link?.id ?? null });
  if (error) throw error;
}
export async function setTaskDone(id: string, done: boolean) {
  const { sb, user } = await requireUser();
  const { error } = await sb.from("tasks").update({ status: done ? "completed" : "todo", completed_at: done ? new Date().toISOString() : null }).eq("id", id).eq("user_id", user.id);
  if (error) throw error;
}
export async function deleteTask(id: string) { const { sb, user } = await requireUser(); const { error } = await sb.from("tasks").delete().eq("id", id).eq("user_id", user.id); if (error) throw error; }

// ---------------- notes ----------------
export async function listNotes(q: string): Promise<NoteRow[]> {
  const { sb, user } = await requireUser();
  let query = sb.from("notes").select("id,title,content,updated_at,entity_type,entity_id").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(100);
  const term = q.trim().slice(0, 80).replace(/[%_,()]/g, " ").trim();
  if (term) query = query.or(`title.ilike.%${term}%,content.ilike.%${term}%`);
  const { data, error } = await query; if (error) throw error;
  type R = { id: string; title: string | null; content: string; updated_at: string; entity_type: string; entity_id: string };
  const rows = (data ?? []) as R[]; const links = await resolveLinks(sb, rows.map((r) => ({ type: r.entity_type, id: r.entity_id })));
  return rows.map((r) => ({ id: r.id, title: r.title, content: r.content, updated_at: r.updated_at, link: linkOf(links, r.entity_type, r.entity_id) }));
}
export async function getNote(id: string): Promise<NoteRow | null> {
  const { sb, user } = await requireUser();
  const { data, error } = await sb.from("notes").select("id,title,content,updated_at,entity_type,entity_id").eq("id", id).eq("user_id", user.id).maybeSingle(); if (error) throw error;
  const r = data as { id: string; title: string | null; content: string; updated_at: string; entity_type: string; entity_id: string } | null; if (!r) return null;
  const links = await resolveLinks(sb, [{ type: r.entity_type, id: r.entity_id }]); return { id: r.id, title: r.title, content: r.content, updated_at: r.updated_at, link: linkOf(links, r.entity_type, r.entity_id) };
}
export async function deleteNote(id: string) { const { sb, user } = await requireUser(); const { error } = await sb.from("notes").delete().eq("id", id).eq("user_id", user.id); if (error) throw error; }

// ---------------- resources ----------------
export async function listResources(): Promise<{ mine: ResourceRow[]; official: ResourceRow[] }> {
  const { sb, user } = await requireUser();
  const { data, error } = await sb.from("resources").select("id,title,url,type,description,user_id,entity_type,entity_id").or(`user_id.eq.${user.id},user_id.is.null`).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  type R = { id: string; title: string; url: string | null; type: string | null; description: string | null; user_id: string | null; entity_type: string | null; entity_id: string | null };
  const rows = (data ?? []) as R[]; const links = await resolveLinks(sb, rows.map((r) => ({ type: r.entity_type, id: r.entity_id })));
  const map = (r: R): ResourceRow => ({ id: r.id, title: r.title, url: r.url, type: r.type ?? "other", description: r.description, official: r.user_id === null, link: linkOf(links, r.entity_type, r.entity_id) });
  return { mine: rows.filter((r) => r.user_id === user.id).map(map), official: rows.filter((r) => r.user_id === null).map(map) };
}
export async function createResource(i: { title: string; url: string | null; type: string; description: string | null; link: { type: EntityType; id: string } | null }) {
  if (i.url && !/^https?:\/\//i.test(i.url)) throw new Error("Links must start with http:// or https://");
  const { sb, user } = await requireUser();
  const { error } = await sb.from("resources").insert({ user_id: user.id, title: i.title, url: i.url, type: i.type, description: i.description, entity_type: i.link?.type ?? null, entity_id: i.link?.id ?? null });
  if (error) throw error;
}
export async function deleteResource(id: string) { const { sb, user } = await requireUser(); const { error } = await sb.from("resources").delete().eq("id", id).eq("user_id", user.id); if (error) throw error; }

/** Items the learner can attach a note/task/resource to: what they have started (newest first), capped. */
export async function linkChoices(): Promise<LinkRef[]> {
  const { sb, user } = await requireUser();
  const { data, error } = await sb.from("user_progress").select("entity_type,entity_id,last_studied_at").eq("user_id", user.id).in("entity_type", LINKABLE).order("last_studied_at", { ascending: false, nullsFirst: false }).limit(60);
  if (error) throw error;
  const rows = (data ?? []) as { entity_type: EntityType; entity_id: string }[]; const links = await resolveLinks(sb, rows.map((r) => ({ type: r.entity_type, id: r.entity_id })));
  return rows.map((r) => links.get(`${r.entity_type}:${r.entity_id}`)).filter((x): x is LinkRef => !!x);
}
export async function linkFor(type: string | undefined, id: string | undefined): Promise<LinkRef | null> {
  if (!type || !id || !LINKABLE.includes(type as EntityType)) return null;
  const { sb } = await requireUser(); return (await resolveLinks(sb, [{ type, id }])).get(`${type}:${id}`) ?? null;
}
export { first };
