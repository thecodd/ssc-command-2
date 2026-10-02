import { getUser, requireUser, getDb } from "@/lib/auth";
import { escLike, first, pad2 } from "@/lib/format";
import { getProgressMap, EMPTY_PROGRESS } from "./progress";
import { fetchAll, firstPage, rangeOf, type Page } from "@/lib/paging";
import { toMapping } from "./mappings";
import type { SyllabusFilters, SyllabusItem } from "@/types/curriculum";

// With a topic filter the mapping embed becomes an INNER join, so Postgres filters chapters by relationship (no id lists in the URL).
const chSelect = (byTopic: boolean) => `id,title,number,relevance,priority,estimated_minutes,books!inner(id,title,edition,academic_year,subjects!inner(id,name,classes!inner(grade))),ncert_ssc_mappings${byTopic ? "!inner" : ""}(mapping_type,relevance,ssc_topics(id,title,ssc_subjects(name)))`;
const TP_SELECT = "id,title,priority,estimated_minutes,owner_id,ssc_subjects!inner(id,name,ssc_tiers!inner(name,ssc_exams!inner(name,exam_version)))";

export interface SyllabusResult { items: SyllabusItem[]; total: number; truncated: boolean }

/** Reads one page (default) or everything (needed when a client-side-only filter such as status is active). */
async function pull(build: (from: number, to: number) => any, page: Page, all: boolean) {
  if (all) { const rows = await fetchAll<any>(build); return { rows, count: rows.length }; }
  const { data, error, count } = await build(...rangeOf(page));
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as any[], count: (count ?? data?.length ?? 0) as number };
}

export async function getSyllabus(f: SyllabusFilters, page: Page = firstPage()): Promise<SyllabusResult> {
  const { sb, user } = await getUser();
  const empty = new Map();
  const [pc, pt] = user ? await Promise.all([getProgressMap(sb, user.id, "ncert_chapter"), getProgressMap(sb, user.id, "ssc_topic")]) : [empty, empty];
  const wantN = f.source !== "ssc";
  const wantS = f.source !== "ncert" && !f.cls && !f.relevance;
  const all = !!f.status; // status lives in user_progress (polymorphic, no FK), so it is applied after the fetch
  const items: SyllabusItem[] = [];
  let total = 0, fetched = 0;

  if (wantN) {
    const { rows, count } = await pull((a, b) => {
      let q = sb.from("chapters").select(chSelect(!!f.topic), { count: "exact" }).eq("archived", false).order("id").range(a, b);
      if (f.cls) q = q.eq("books.subjects.classes.grade", f.cls);
      if (f.subject) q = q.eq("books.subjects.name", f.subject);
      if (f.relevance) q = q.eq("relevance", f.relevance);
      if (f.priority) q = q.eq("priority", f.priority);
      if (f.q) q = q.ilike("title", `%${escLike(f.q)}%`);
      if (f.topic) q = q.eq("ncert_ssc_mappings.ssc_topic_id", f.topic);
      return q;
    }, page, all);
    total += count; fetched += rows.length;
    for (const r of rows) {
      const bk: any = first(r.books), sj: any = first(bk?.subjects), grade = first<any>(sj?.classes)?.grade ?? 0;
      const p = pc.get(r.id) ?? EMPTY_PROGRESS;
      const conns = (r.ncert_ssc_mappings ?? []).map((m: any) => { const t: any = first(m.ssc_topics); return t ? `${first<any>(t.ssc_subjects)?.name ?? ""} → ${t.title}` : ""; }).filter(Boolean);
      items.push({
        kind: "ncert", id: r.id, href: `/ncert/chapter/${r.id}`, title: r.title, source: "NCERT", book: bk?.title,
        meta: `Class ${grade} · ${sj?.name ?? ""}${bk?.title ? " · " + bk.title : ""}`,
        group: `Class ${pad2(grade)} · ${sj?.name ?? ""}`, sortKey: `${pad2(grade)}|${sj?.name}|${String(r.number ?? 999).padStart(3, "0")}`,
        relevance: r.relevance, priority: r.priority, estimated_minutes: r.estimated_minutes, status: p.status, completion: p.completion, connections: conns,
      });
    }
  }
  if (wantS) {
    const { rows, count } = await pull((a, b) => {
      let q = sb.from("ssc_topics").select(TP_SELECT, { count: "exact" }).eq("archived", false).order("id").range(a, b);
      if (f.subject) q = q.eq("ssc_subjects.name", f.subject);
      if (f.priority) q = q.eq("priority", f.priority);
      if (f.topic) q = q.eq("id", f.topic);
      if (f.q) q = q.ilike("title", `%${escLike(f.q)}%`);
      return q;
    }, page, all);
    total += count; fetched += rows.length;
    for (const r of rows) {
      const ss: any = first(r.ssc_subjects), tr: any = first(ss?.ssc_tiers), ex: any = first(tr?.ssc_exams);
      const p = pt.get(r.id) ?? EMPTY_PROGRESS;
      const exam = ex ? `${ex.name} ${ex.exam_version}` : "SSC";
      items.push({
        kind: "ssc", id: r.id, href: `/ssc/topic/${r.id}`, title: r.title, source: "SSC",
        meta: `${tr?.name ?? ""} · ${ss?.name ?? ""}${r.owner_id ? " · Custom" : ""}`,
        group: `${exam} · ${tr?.name ?? ""} · ${ss?.name ?? ""}`, sortKey: `${exam}|${tr?.name}|${ss?.name}|${r.title}`,
        priority: r.priority, estimated_minutes: r.estimated_minutes, status: p.status, completion: p.completion, connections: [],
      });
    }
  }
  const out = (f.status ? items.filter((i) => i.status === f.status) : items)
    .sort((a, b) => (a.kind === b.kind ? a.sortKey.localeCompare(b.sortKey, undefined, { numeric: true }) : a.kind === "ncert" ? -1 : 1));
  return { items: out, total: f.status ? out.length : total, truncated: !all && fetched < total };
}

export async function getFilterOptions() {
  const sb = getDb();
  const [c, s, ss, t] = await Promise.all([
    sb.from("classes").select("grade").order("grade"),
    sb.from("subjects").select("name").eq("archived", false),
    sb.from("ssc_subjects").select("name").eq("archived", false),
    fetchAll<{ id: string; title: string }>((a, b) => sb.from("ssc_topics").select("id,title").eq("archived", false).order("title").order("id").range(a, b)).then((data) => ({ data, error: null })),
  ]);
  for (const r of [c, s, ss, t]) if (r.error) throw r.error;
  const subjects = Array.from(new Set([...(s.data ?? []), ...(ss.data ?? [])].map((r: any) => r.name))).sort();
  return { classes: (c.data ?? []).map((r: any) => r.grade as number), subjects, topics: t.data as { id: string; title: string }[] };
}

export async function getSscSubjectOptions() {
  const sb = getDb();
  const { data, error } = await sb.from("ssc_subjects").select("id,name,ssc_tiers(name,ssc_exams(name,exam_version))").eq("archived", false);
  if (error) throw error;
  return (data ?? []).map((r: any) => { const tr: any = first(r.ssc_tiers), ex: any = first(tr?.ssc_exams); return { id: r.id as string, label: `${ex ? ex.name + " " + ex.exam_version + " · " : ""}${tr?.name ?? ""} · ${r.name}` }; }).sort((a, b) => a.label.localeCompare(b.label));
}

export async function createCustomTopic(input: { subject_id: string; title: string; priority: string; estimated_minutes: number | null }) {
  const { sb, user } = await requireUser();
  const { data, error } = await sb.from("ssc_topics").insert({ ...input, owner_id: user.id }).select("id").single();
  if (error) throw error;
  return data.id as string;
}
export { toMapping };
