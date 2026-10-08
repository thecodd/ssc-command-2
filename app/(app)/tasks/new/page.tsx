import { ActionForm } from "@/components/ui/ActionForm";
import { fieldCls } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/PageHeader";
import { LinkSelect } from "@/components/workspace/LinkSelect";
import { createTaskAction } from "@/app/actions/workspace";
import { linkChoices, linkFor } from "@/services/workspace";
import { getClock } from "@/services/profile";
import { PRIORITY_LABEL } from "@/lib/format";
export const dynamic = "force-dynamic";
export default async function NewTask(props: { searchParams: Promise<{ type?: string; id?: string }> }) {
  const searchParams = await props.searchParams;
  const [choices, preset, { today }] = await Promise.all([linkChoices(), linkFor(searchParams.type, searchParams.id), getClock()]);
  return (
    <div className="mx-auto max-w-xl"><PageHeader title="New task" />
      <ActionForm action={createTaskAction} submit="Add task" className="card space-y-4 p-5">
        <input type="hidden" name="redirect" value="1" />
        <label className="block text-sm text-sub">Title<input name="title" required maxLength={160} className={`${fieldCls} mt-1`} placeholder="e.g. Revise Percentage formulas" /></label>
        <label className="block text-sm text-sub">Details (optional)<textarea name="description" rows={3} maxLength={2000} className={`${fieldCls} mt-1 py-3`} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-sub">Due date (optional)<input type="date" name="due_date" defaultValue={today} className={`${fieldCls} mt-1`} /></label>
          <label className="block text-sm text-sub">Priority<select name="priority" defaultValue="medium" className={`${fieldCls} mt-1`}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <LinkSelect choices={choices} preset={preset} />
      </ActionForm>
    </div>);
}
