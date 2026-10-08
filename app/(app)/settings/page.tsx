import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/ui/ActionForm";
import { fieldCls } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/PageHeader";
import { signOutAction, updateProfileAction } from "@/app/actions/workspace";
export const dynamic = "force-dynamic";
export default async function Settings() {
  const { sb, user } = await requireUser();
  const { data } = await sb.from("profiles").select("display_name,daily_goal_minutes,timezone,revision_intervals").eq("id", user.id).maybeSingle();
  const p = (data ?? {}) as { display_name?: string | null; daily_goal_minutes?: number | null; timezone?: string | null; revision_intervals?: number[] | null };
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["Asia/Kolkata", "UTC"];
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader title="Settings" subtitle={user.email ?? undefined} />
      <ActionForm action={updateProfileAction} submit="Save settings" className="card space-y-4 p-5">
        <label className="block text-sm text-sub">Display name<input name="display_name" defaultValue={p.display_name ?? ""} maxLength={60} className={`${fieldCls} mt-1`} /></label>
        <label className="block text-sm text-sub">Daily study goal (minutes)<input name="daily_goal_minutes" type="number" inputMode="numeric" min={10} max={720} required defaultValue={p.daily_goal_minutes ?? 60} className={`${fieldCls} mt-1`} /></label>
        <label className="block text-sm text-sub">Time zone (decides what &ldquo;today&rdquo; means)<select name="timezone" defaultValue={p.timezone ?? "Asia/Kolkata"} className={`${fieldCls} mt-1`}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
        <label className="block text-sm text-sub">Revision ladder (days)<input name="revision_intervals" defaultValue={(p.revision_intervals ?? [1, 3, 7, 15, 30]).join(", ")} className={`${fieldCls} mt-1`} aria-describedby="ladder-hint" />
          <span id="ladder-hint" className="mt-1 block text-xs text-mute">Increasing whole numbers, e.g. 1, 3, 7, 15, 30. Changes apply to future reviews; history is never rewritten.</span></label>
      </ActionForm>
      <form action={signOutAction} className="card p-5"><p className="mb-3 text-sm text-sub">Signed in as {user.email}</p><button type="submit" className="btn-ghost"><LogOut className="h-4 w-4" aria-hidden />Sign out</button></form>
    </div>);
}
