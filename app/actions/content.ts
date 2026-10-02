"use server";
import { revalidatePath } from "next/cache";
import { safe, str, type ActionState } from "@/lib/actions";
import { addNote, addResource, addFocusTask, updateNote } from "@/services/content";
import { isUuid } from "@/lib/filters";
import { createCustomTopic } from "@/services/curriculum";
import type { EntityType } from "@/types/curriculum";

export async function addNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const content = str(fd, "content"); if (!content) throw new Error("Write something first.");
    await addNote({ entity_type: str(fd, "entity_type") as EntityType, entity_id: str(fd, "entity_id")!, title: str(fd, "title"), content });
    revalidatePath(str(fd, "path") ?? "/");
  });
  return r.ok ? { ok: true, message: "Note saved" } : { error: r.error };
}
export async function addResourceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const title = str(fd, "title"); if (!title) throw new Error("Give the resource a title.");
    await addResource({ entity_type: str(fd, "entity_type") as EntityType, entity_id: str(fd, "entity_id")!, title, url: str(fd, "url"), type: str(fd, "type") ?? "other", description: str(fd, "description") });
    revalidatePath(str(fd, "path") ?? "/");
  });
  return r.ok ? { ok: true, message: "Resource added" } : { error: r.error };
}
export async function addTopicAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const title = str(fd, "title"), subject_id = str(fd, "subject_id"); if (!title || !subject_id) throw new Error("Pick a subject and enter a title.");
    const mins = Number(str(fd, "estimated_minutes")) || null;
    const id = await createCustomTopic({ subject_id, title, priority: str(fd, "priority") ?? "medium", estimated_minutes: mins });
    revalidatePath("/syllabus"); return id;
  });
  return r.ok ? { ok: true, message: "Topic added to your syllabus" } : { error: r.error };
}

export async function addFocusAction(type: EntityType, id: string, title: string) {
  return safe(async () => { const r = await addFocusTask(type, id, title); revalidatePath("/dashboard"); return r; });
}

export async function updateNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await safe(async () => {
    const id = str(fd, "id"), content = str(fd, "content");
    if (!isUuid(id)) throw new Error("That note can't be found.");
    if (!content) throw new Error("A note can't be empty.");
    await updateNote({ id, title: str(fd, "title"), content });
    revalidatePath(str(fd, "path") ?? "/");
  });
  return r.ok ? { ok: true, message: "Note saved" } : { error: r.error };
}
