"use client";
import { useState, useTransition } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { importAction, applyImportAction, type ImportState } from "@/app/actions/import";
import { fieldCls } from "@/components/ui/field";
function Btn() { const { pending } = useFormStatus(); return <button disabled={pending} className="btn-primary disabled:opacity-60">{pending ? "Checking..." : "Validate file"}</button>; }
export function ImportForm() {
  const [s, action] = useFormState<ImportState, FormData>(importAction, null);
  const [apply, setApply] = useState<ImportState>(null);
  const [pending, start] = useTransition();
  const rep = s?.report;
  return (
    <form action={action} className="space-y-4">
      <input type="file" name="file" accept=".json,.csv" required className={`${fieldCls} py-2.5 file:mr-3 file:rounded-lg file:border-0 file:bg-raised file:px-3 file:py-1.5 file:text-ink`} />
      <label className="flex min-h-[44px] items-center gap-3 text-sm text-sub"><input type="checkbox" name="mode" value="apply" className="h-5 w-5 accent-[#B8FF3D]" />Prepare for import (otherwise this is a dry run that cannot be applied)</label>
      <Btn />
      {s?.error && <p role="alert" className="text-sm text-red-400">{s.error}</p>}
      {rep && (
        <div role="status" className="space-y-2 rounded-card border border-line p-4 text-sm">
          <p className={rep.status === "validated" ? "font-medium text-lime" : "font-medium text-red-400"}>{rep.status === "validated" ? "File is valid" : "File has problems"}</p>
          <p className="text-sub">{rep.counts.total} rows · {rep.counts.valid} valid · {rep.counts.invalid} invalid</p>
          {rep.errors.length > 0 && <ul className="max-h-48 overflow-y-auto text-xs text-sub">{rep.errors.map((e, i) => <li key={i}>{e.kind} row {e.row}: {e.errors.map((x) => x.message).join("; ")}</li>)}</ul>}
          {rep.status === "validated" && <button type="button" disabled={pending} className="btn-ghost" onClick={() => start(async () => setApply(await applyImportAction(rep.run_id)))}>Apply as DRAFT (nothing goes live)</button>}
          {apply?.error && <p role="alert" className="text-red-400">{apply.error}</p>}
          {apply?.applied && <p className="text-lime">Created draft content: {apply.applied.ncert} NCERT rows, {apply.applied.ssc} SSC rows, {apply.applied.mapping} mappings. Publish it from the admin tools after review.</p>}
        </div>
      )}
    </form>
  );
}
