"use client";
import { useFormState, useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions";
function Submit({ label, danger }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return <button disabled={pending} className={`${danger ? "btn border border-red-500/40 text-red-400 hover:bg-red-500/10" : "btn-primary"} disabled:opacity-60`}>{pending ? "Saving..." : label}</button>;
}
export function ActionForm({ action, submit, children, className = "space-y-3", danger }: { action: (p: ActionState, f: FormData) => Promise<ActionState>; submit: string; children?: React.ReactNode; className?: string; danger?: boolean }) {
  const [state, formAction] = useFormState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <p role="alert" className="text-sm text-red-400">{state.error}</p>}
      {state?.ok && <p role="status" className="text-sm text-lime">{state.message ?? "Done"}</p>}
      <Submit label={submit} danger={danger} />
    </form>
  );
}
export const fieldCls = "min-h-[44px] w-full rounded-ctl border border-line bg-surface px-3 text-base outline-none focus:border-lime lg:text-sm";
