"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safe, str, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/filters";
import { requireUser, getDb } from "@/lib/auth";
import { isValidTimeZone } from "@/lib/time";
import { addNote, updateNote } from "@/services/content";
import * as W from "@/services/workspace";
import type { EntityType } from "@/types/curriculum";

// Workspace actions (tasks, notes, resources, settings). Validation first; database errors reach the user only as our own copy (lib/actions safe()).
const PRIORITIES = ["very_high", "high", "medium", "low"], RTYPES = ["pdf", "video", "website", "book", "notes", "other"];
const link = (fd: FormData): { type: EntityType; id: string } | null => { const v = str(fd, "link"); if (!v) return null; const [t, id] = v.split(":"); if (!W.LINKABLE.includes(t as EntityType) || !isUuid(id)) throw new Error("Pick an item from the list."); return { type: t as EntityType, id }; };
const date = (fd: FormData, k: string) => { const v = str(fd, k); if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error("Use a valid date."); return v; };
const done = (r: { ok: boolean; error?: string }, message: string): ActionState => (r.ok ? { ok: true, message } : { error: (r as { error: string }).error });

export async function createTaskAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const title = str(fd, "title"); if (!title) throw new Error("Give the task a title."); if (title.length > 160) throw new Error("Keep the title under 160 characters.");
    const priority = str(fd, "priority") ?? "medium"; if (!PRIORITIES.includes(priority)) throw new Error("Unknown priority.");
    await W.createTask({ title, description: str(fd, "description")?.slice(0, 2000) ?? null, due_date: date(fd, "due_date"), priority, link: link(fd) });
    revalidatePath("/tasks"); revalidatePath("/dashboard");
  });
  if (r.ok && str(fd, "redirect") === "1") redirect("/tasks");
  return done(r, "Task added");
}
export async function toggleTaskAction(id: string, isDone: boolean) { return safe(async () => { if (!isUuid(id)) throw new Error("Unknown task."); await W.setTaskDone(id, isDone); revalidatePath("/tasks"); revalidatePath("/dashboard"); }); }
export async function deleteTaskAction(id: string) { return safe(async () => { if (!isUuid(id)) throw new Error("Unknown task."); await W.deleteTask(id); revalidatePath("/tasks"); revalidatePath("/dashboard"); }); }

export async function createNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const l = link(fd); if (!l) throw new Error("Notes belong to a chapter or topic: pick one."); const content = str(fd, "content"); if (!content) throw new Error("Write something first.");
    await addNote({ entity_type: l.type, entity_id: l.id, title: str(fd, "title")?.slice(0, 160) ?? null, content: content.slice(0, 20000) }); revalidatePath("/notes");
  });
  if (r.ok) redirect("/notes");
  return done(r, "Note saved");
}
export async function editNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => { const id = str(fd, "id"), content = str(fd, "content"); if (!isUuid(id)) throw new Error("Unknown note."); if (!content) throw new Error("A note can't be empty."); await updateNote({ id: id!, title: str(fd, "title")?.slice(0, 160) ?? null, content: content.slice(0, 20000) }); revalidatePath("/notes"); });
  return done(r, "Note saved");
}
export async function deleteNoteAction(id: string) { return safe(async () => { if (!isUuid(id)) throw new Error("Unknown note."); await W.deleteNote(id); revalidatePath("/notes"); }); }

export async function createResourceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const title = str(fd, "title"); if (!title) throw new Error("Give the resource a title."); const type = str(fd, "type") ?? "other"; if (!RTYPES.includes(type)) throw new Error("Unknown type.");
    await W.createResource({ title: title.slice(0, 160), url: str(fd, "url"), type, description: str(fd, "description")?.slice(0, 2000) ?? null, link: link(fd) }); revalidatePath("/resources");
  });
  if (r.ok) redirect("/resources");
  return done(r, "Resource added");
}
export async function deleteResourceAction(id: string) { return safe(async () => { if (!isUuid(id)) throw new Error("Unknown resource."); await W.deleteResource(id); revalidatePath("/resources"); }); }

export async function updateProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const name = str(fd, "display_name")?.slice(0, 60) ?? null, goal = Number(str(fd, "daily_goal_minutes")), tz = str(fd, "timezone") ?? "";
    if (!Number.isInteger(goal) || goal < 10 || goal > 720) throw new Error("Daily goal must be between 10 and 720 minutes.");
    if (!isValidTimeZone(tz)) throw new Error("Unknown time zone.");
    const ladder = (str(fd, "revision_intervals") ?? "").split(/[\s,]+/).filter(Boolean).map(Number);
    if (ladder.length < 2 || ladder.length > 10 || ladder.some((n) => !Number.isInteger(n) || n < 1 || n > 365) || ladder.some((n, i) => i > 0 && n <= ladder[i - 1])) throw new Error("Revision ladder: 2-10 increasing whole numbers of days (1-365), e.g. 1, 3, 7, 15, 30.");
    const { sb, user } = await requireUser();
    const { error } = await sb.from("profiles").update({ display_name: name, daily_goal_minutes: goal, timezone: tz, revision_intervals: ladder }).eq("id", user.id); if (error) throw error;
    revalidatePath("/", "layout");
  });
  return done(r, "Settings saved");
}
export async function signOutAction() {
  await getDb().auth.signOut();
  redirect("/login");
}
