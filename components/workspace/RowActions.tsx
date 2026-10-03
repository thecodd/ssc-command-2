"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, Trash2 } from "lucide-react";
import { deleteNoteAction, deleteResourceAction, deleteTaskAction, toggleTaskAction } from "@/app/actions/workspace";
type R = { ok: true } | { ok: false; error: string };
function useAct(afterHref?: string) {
  const router = useRouter(), [pending, start] = useTransition(), [error, setError] = useState<string | null>(null);
  const go = (fn: () => Promise<R | { ok: boolean; error?: string; data?: unknown }>) => start(async () => { setError(null); const r = await fn(); if (!r.ok) setError((r as { error?: string }).error ?? "Something went wrong."); else if (afterHref) router.push(afterHref); else router.refresh(); });
  return { pending, error, go };
}
export function TaskToggle({ id, done, title }: { id: string; done: boolean; title: string }) {
  const { pending, error, go } = useAct();
  return (<><button type="button" aria-pressed={done} aria-label={`${title}: ${done ? "completed, mark as not done" : "mark as done"}`} disabled={pending} onClick={() => go(() => toggleTaskAction(id, !done))}
    className="grid h-11 w-11 shrink-0 place-items-center rounded-ctl hover:bg-raised disabled:opacity-60">{done ? <Check className="h-5 w-5 text-lime" aria-hidden /> : <Circle className="h-5 w-5 text-mute" strokeWidth={1.5} aria-hidden />}</button>
    {error && <span role="alert" className="text-xs text-red-400">{error}</span>}</>);
}
export function DeleteButton({ kind, id, title, afterHref }: { kind: "task" | "note" | "resource"; id: string; title: string; afterHref?: string }) {
  const { pending, error, go } = useAct(afterHref); const [confirm, setConfirm] = useState(false);
  const act = kind === "task" ? deleteTaskAction : kind === "note" ? deleteNoteAction : deleteResourceAction;
  if (confirm) return (<span className="flex items-center gap-1"><button type="button" disabled={pending} onClick={() => go(() => act(id))} className="min-h-[44px] rounded-ctl px-3 text-sm text-red-400 hover:bg-red-500/10">{pending ? "Deleting…" : "Delete"}</button><button type="button" onClick={() => setConfirm(false)} className="min-h-[44px] rounded-ctl px-3 text-sm text-sub hover:bg-raised">Cancel</button>{error && <span role="alert" className="text-xs text-red-400">{error}</span>}</span>);
  return <button type="button" onClick={() => setConfirm(true)} aria-label={`Delete ${title}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-ctl text-mute hover:bg-raised hover:text-red-400"><Trash2 className="h-4 w-4" aria-hidden /></button>;
}
