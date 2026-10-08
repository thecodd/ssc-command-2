"use client";
import { useState, useTransition } from "react";
import type { PublishRow } from "@/services/admin";
import { useRouter } from "next/navigation";
import { NEXT_STEPS } from "@/lib/admin/publish";
import { setExamOfficialAction, setPublishStatusAction, verifySourceAction } from "@/app/actions/admin";
type R = { ok: true } | { ok: false; error: string };
export function PublishControls({ row }: { row: PublishRow }) {
  const router = useRouter(), [pending, start] = useTransition(), [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<R>) => start(async () => { setError(null); const r = await fn(); if (!r.ok) setError(r.error); else router.refresh(); });
  const btn = "btn-ghost min-h-[44px] disabled:opacity-60";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {NEXT_STEPS[row.status].map((s) => (
        <button key={s.to} type="button" disabled={pending} className={btn} aria-label={`${s.label}: ${row.title}`} onClick={() => run(() => setPublishStatusAction(row.kind, row.id, row.status, s.to))}>{s.label}</button>))}
      {row.sourceId && <button type="button" disabled={pending} className={btn} aria-label={`${row.sourceVerified ? "Remove verification from" : "Verify"} source of ${row.title}`} onClick={() => run(() => verifySourceAction(row.sourceId!, !row.sourceVerified))}>{row.sourceVerified ? "Unverify source" : "Verify source"}</button>}
      {row.kind === "ssc_exam" && <button type="button" disabled={pending} className={btn} aria-label={`${row.official ? "Remove official mark from" : "Mark official:"} ${row.title}`} onClick={() => run(() => setExamOfficialAction(row.id, !row.official))}>{row.official ? "Remove official mark" : "Mark official"}</button>}
      {error && <p role="alert" className="w-full text-sm text-red-400">{error}</p>}
    </div>);
}
