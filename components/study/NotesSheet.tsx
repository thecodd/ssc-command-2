"use client";
import { useState } from "react";
import { ExternalLink, Pencil, StickyNote } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { ActionForm } from "@/components/ui/ActionForm";
import { fieldCls } from "@/components/ui/field";
import { addNoteAction, addResourceAction, updateNoteAction } from "@/app/actions/content";
import { RESOURCE_TYPES } from "@/lib/format";
import type { StudyMaterial, StudyNote } from "@/types/study";
import { useStudy } from "./StudyProvider";

const Hidden = ({ path }: { path: string }) => { const { type, id } = useStudy(); return <><input type="hidden" name="entity_type" value={type} /><input type="hidden" name="entity_id" value={id} /><input type="hidden" name="path" value={path} /></>; };

function NoteRow({ n, path }: { n: StudyNote; path: string }) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="border-t border-line pt-4">
      {editing ? (
        <div className="space-y-2">
          <ActionForm action={updateNoteAction} submit="Save changes">
            <input type="hidden" name="id" value={n.id} /><input type="hidden" name="path" value={path} />
            <input name="title" defaultValue={n.title ?? ""} placeholder="Title (optional)" aria-label="Note title" className={fieldCls} />
            <textarea name="content" required defaultValue={n.content} rows={5} aria-label="Note" className={`${fieldCls} py-3`} />
          </ActionForm>
          <button type="button" className="min-h-[44px] text-sm text-sub underline" onClick={() => setEditing(false)}>Done editing</button>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3"><p className="font-medium">{n.title || "Untitled note"}</p>
            <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${n.title || "note"}`} className="grid h-11 w-11 shrink-0 place-items-center text-mute hover:text-ink"><Pencil className="h-4 w-4" /></button></div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-sub">{n.content}</p>
        </>
      )}
    </article>
  );
}

/** Notes + resources without leaving the study flow. Plain forms over the existing server actions; deliberately not an editor. */
export function NotesSheet({ notes, materials, path }: { notes: StudyNote[]; materials: StudyMaterial[]; path: string }) {
  const { sheet, openSheet, api } = useStudy();
  const fixture = api.mode === "fixture";
  return (
    <Sheet open={sheet !== null} onClose={() => openSheet(null)} title={sheet === "resources" ? "Resources" : "Notes"}>
      <div role="group" aria-label="Section" className="mb-4 grid grid-cols-2 gap-2">
        {(["notes", "resources"] as const).map((t) => <button key={t} type="button" aria-pressed={sheet === t} onClick={() => openSheet(t)} className={`btn-ghost ${sheet === t ? "border-lime/50 bg-lime-dim text-lime" : ""}`}>{t === "notes" ? `Notes (${notes.length})` : `Resources (${materials.filter((m) => !m.official).length})`}</button>)}
      </div>
      {fixture ? <p className="text-sm text-sub">Notes and resources are disabled in the fixture preview (no data is saved).</p> : sheet === "resources" ? (
        <div className="space-y-4">
          <ActionForm action={addResourceAction} submit="Add resource"><Hidden path={path} />
            <input name="title" required placeholder="Title" aria-label="Resource title" className={fieldCls} />
            <input name="url" type="url" inputMode="url" placeholder="https://" aria-label="Link" className={fieldCls} />
            <select name="type" defaultValue="website" aria-label="Type" className={fieldCls}>{RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t === "pdf" ? "PDF" : t[0].toUpperCase() + t.slice(1)}</option>)}</select>
          </ActionForm>
          <ul className="divide-y divide-line">{materials.map((r) => <li key={r.id}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer noopener" className="flex min-h-[52px] items-center justify-between gap-3 hover:text-lime"><span className="min-w-0"><span className="block truncate">{r.title}</span><span className="text-xs text-mute">{r.official ? "Official · " : ""}{r.type}</span></span><ExternalLink className="h-4 w-4 shrink-0 text-mute" aria-hidden /></a> : <p className="py-3">{r.title}</p>}</li>)}</ul>
        </div>
      ) : (
        <div className="space-y-4">
          <ActionForm action={addNoteAction} submit="Save note"><Hidden path={path} />
            <input name="title" placeholder="Title (optional)" aria-label="Note title" className={fieldCls} />
            <textarea name="content" required rows={4} placeholder="Write a note" aria-label="Note" className={`${fieldCls} py-3`} />
          </ActionForm>
          {notes.length === 0 ? <p className="flex items-center gap-2 text-sm text-mute"><StickyNote className="h-4 w-4" aria-hidden />No notes yet. They&apos;re private to you.</p> : notes.map((n) => <NoteRow key={n.id} n={n} path={path} />)}
        </div>
      )}
    </Sheet>
  );
}

export function OpenSheetButton({ tab, children, className = "btn-ghost" }: { tab: "notes" | "resources"; children: React.ReactNode; className?: string }) {
  const { openSheet } = useStudy();
  return <button type="button" onClick={() => openSheet(tab)} className={className}>{children}</button>;
}
