import { ActionForm } from "@/components/ui/ActionForm";
import { fieldCls } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkSelect } from "@/components/workspace/LinkSelect";
import { createResourceAction } from "@/app/actions/workspace";
import { linkChoices, linkFor } from "@/services/workspace";
import { RESOURCE_TYPES } from "@/lib/format";
export const dynamic = "force-dynamic";
export default async function NewResource({ searchParams }: { searchParams: { type?: string; id?: string } }) {
  const [choices, preset] = await Promise.all([linkChoices(), linkFor(searchParams.type, searchParams.id)]);
  return (
    <div className="mx-auto max-w-xl"><PageHeader title="Add a resource" />
      <ActionForm action={createResourceAction} submit="Save resource" className="card space-y-4 p-5">
        <label className="block text-sm text-sub">Title<input name="title" required maxLength={160} className={`${fieldCls} mt-1`} /></label>
        <label className="block text-sm text-sub">Link (optional)<input name="url" type="url" inputMode="url" placeholder="https://" className={`${fieldCls} mt-1`} /></label>
        <label className="block text-sm text-sub">Type<select name="type" defaultValue="website" className={`${fieldCls} mt-1`}>{RESOURCE_TYPES.map((t) => <option key={t} value={t}>{t === "pdf" ? "PDF" : t[0].toUpperCase() + t.slice(1)}</option>)}</select></label>
        <label className="block text-sm text-sub">Description (optional)<textarea name="description" rows={3} maxLength={2000} className={`${fieldCls} mt-1 py-3`} /></label>
        <LinkSelect choices={choices} preset={preset} />
      </ActionForm>
    </div>);
}
