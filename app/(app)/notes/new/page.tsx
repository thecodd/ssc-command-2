import { StickyNote } from "lucide-react";
import { ActionForm, fieldCls } from "@/components/ui/ActionForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkSelect } from "@/components/workspace/LinkSelect";
import { createNoteAction } from "@/app/actions/workspace";
import { linkChoices, linkFor } from "@/services/workspace";
export const dynamic = "force-dynamic";
export default async function NewNote({ searchParams }: { searchParams: { type?: string; id?: string } }) {
  const [choices, preset] = await Promise.all([linkChoices(), linkFor(searchParams.type, searchParams.id)]);
  if (!choices.length && !preset) return <EmptyState icon={StickyNote} title="Notes belong to a chapter or topic" hint="Open something from the syllabus and start studying it; then you can write notes for it here or in Study Mode." action={{ href: "/syllabus", label: "Open the syllabus" }} />;
  return (
    <div className="mx-auto max-w-xl"><PageHeader title="New note" />
      <ActionForm action={createNoteAction} submit="Save note" className="card space-y-4 p-5">
        <LinkSelect choices={choices} preset={preset} required label="For" />
        <label className="block text-sm text-sub">Title (optional)<input name="title" maxLength={160} className={`${fieldCls} mt-1`} /></label>
        <label className="block text-sm text-sub">Note<textarea name="content" required rows={8} maxLength={20000} className={`${fieldCls} mt-1 py-3`} /></label>
      </ActionForm>
    </div>);
}
