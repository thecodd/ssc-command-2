import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, fieldCls } from "@/components/ui/ActionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { DeleteButton } from "@/components/workspace/RowActions";
import { editNoteAction } from "@/app/actions/workspace";
import { getNote } from "@/services/workspace";
import { isUuid } from "@/lib/filters";
export const dynamic = "force-dynamic";
export default async function NotePage({ params }: { params: { id: string } }) {
  if (!isUuid(params.id)) notFound();
  const n = await getNote(params.id); if (!n) notFound();
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={n.title || "Untitled note"} subtitle={n.link ? `For ${n.link.title}` : undefined} actions={<DeleteButton kind="note" id={n.id} title={n.title || "note"} afterHref="/notes" />} />
      <ActionForm action={editNoteAction} submit="Save changes" className="card space-y-4 p-5">
        <input type="hidden" name="id" value={n.id} />
        <label className="block text-sm text-sub">Title<input name="title" defaultValue={n.title ?? ""} maxLength={160} className={`${fieldCls} mt-1`} /></label>
        <label className="block text-sm text-sub">Note<textarea name="content" required rows={12} defaultValue={n.content} maxLength={20000} className={`${fieldCls} mt-1 py-3`} /></label>
      </ActionForm>
      <div className="mt-4 flex flex-wrap gap-2"><Link href="/notes" className="btn-ghost">All notes</Link>{n.link && <Link href={n.link.href} className="btn-ghost">Study {n.link.title}</Link>}</div>
    </div>);
}
