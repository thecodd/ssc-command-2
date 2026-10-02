import { createHash } from "node:crypto";
import { requireAdmin } from "@/lib/auth";
import type { ImportData } from "@/lib/import/parse";
// Staging flow: create run -> stage rows -> validate (SQL) -> apply (one SQL transaction, DRAFT only). Trust flags are rejected by the database.
export interface ImportReport { run_id: string; status: string; counts: Record<string, number>; errors: { kind: string; row: number; errors: { field: string; message: string }[] }[] }
const rpc = async (fn: string, args: Record<string, unknown>) => { const { sb } = await requireAdmin(); const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; };

export async function stageAndValidate(fileName: string, text: string, data: ImportData, dryRun: boolean): Promise<ImportReport> {
  const sha = createHash("sha256").update(text).digest("hex");
  const runId = (await rpc("import_create_run", { p_file_name: fileName, p_sha256: sha, p_source: data.source ?? {}, p_dry_run: dryRun })) as string;
  for (const [kind, rows] of [["ncert", data.ncert], ["ssc", data.ssc], ["mapping", data.mappings]] as const) {
    for (let i = 0; i < rows.length; i += 1000) await rpc("import_stage_rows", { p_run: runId, p_kind: kind, p_rows: rows.slice(i, i + 1000) });
  }
  return (await rpc("import_validate_run", { p_run: runId })) as ImportReport;
}
export const applyRun = (runId: string) => rpc("import_apply_run", { p_run: runId }) as Promise<{ run_id: string; applied: Record<string, number>; published: boolean; note: string }>;
export const discardRun = (runId: string) => rpc("import_discard_run", { p_run: runId });
