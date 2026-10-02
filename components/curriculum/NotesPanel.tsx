import { ActionForm, fieldCls } from "@/components/ui/ActionForm";
import { addNoteAction, addResourceAction } from "@/app/actions/content";
import { RESOURCE_TYPES } from "@/lib/format";
import { ExternalLink } from "lucide-react";
import type { EntityType } from "@/types/curriculum";
const Hidden = ({ type, id, path }: { type: EntityType; id: string; path: string }) => <><input type="hidden" name="entity_type" value={type} /><input type="hidden" name="entity_id" value={id} /><input type="hidden" name="path" value={path} /></>;

export function NotesPanel({ type, id, path, notes }: { type: EntityType; id: string; path: string; notes: any[] }) {
  return (
    <div className="space-y-4">
      <ActionForm action={addNoteAction} submit="Save note"><Hidden type={type} id={id} path={path} />
        <input name="title" placeholder="Title (optional)" className={fieldCls} />
        <textarea name="content" required rows={4} placeholder="Write a note" className={`${fieldCls} py-3`} />
      </ActionForm>
      {notes.length === 0 && <p className="text-sm text-mute">No notes yet. Your notes are private to you.</p>}
      {notes.map((n) => <article key={n.id} className="border-t border-line pt-4"><p className="font-medium">{n.title || "Untitled note"}</p><p className="mt-1 whitespace-pre-wrap text-sm text-sub">{n.content}</p></article>)}
    </div>
  );
}
export function ResourcesPanel({ type, id, path, resources }: { type: EntityType; id: string; path: string; resources: any[] }) {
  return (
    <div className="space-y-4">
      <ActionForm action={addResourceAction} submit="Add resource"><Hidden type={type} id={id} path={path} />
        <input name="title" required placeholder="Title" className={fieldCls} />
        <input name="url" type="url" placeholder="https://" className={fieldCls} />
        <select name="type" defaultValue="website" className={fieldCls}>{RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t === "pdf" ? "PDF" : t[0].toUpperCase() + t.slice(1)}</option>)}</select>
      </ActionForm>
      {resources.length === 0 && <p className="text-sm text-mute">No resources yet. Add a PDF, video or link you trust.</p>}
      <ul className="divide-y divide-line">{resources.map((r) => (
        <li key={r.id}><a href={r.url ?? undefined} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center justify-between gap-3 hover:text-lime"><span className="min-w-0"><span className="block truncate">{r.title}</span><span className="text-xs text-mute">{r.type}</span></span>{r.url && <ExternalLink className="h-4 w-4 shrink-0 text-mute" />}</a></li>))}</ul>
    </div>
  );
}
