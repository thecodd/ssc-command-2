"use server";
import { revalidatePath } from "next/cache";
import { safe } from "@/lib/actions";
import { toImportData } from "@/lib/import/parse";
import { stageAndValidate, applyRun, type ImportReport } from "@/services/import";
export type ImportState = { report?: ImportReport; applied?: { ncert: number; ssc: number; mapping: number }; error?: string } | null;

/** Step 1: parse, stage and validate. Writes nothing to curriculum tables. Real runs are applied with applyImportAction. */
export async function importAction(_: ImportState, fd: FormData): Promise<ImportState> {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a .json or .csv file." };
  if (file.size > 5_000_000) return { error: "File is over 5 MB. Split it into smaller files." };
  const name = file.name.toLowerCase(), kind = name.endsWith(".json") ? "json" : name.endsWith(".csv") ? "csv" : null;
  if (!kind) return { error: "Only .json and .csv files are supported." };
  const dryRun = fd.get("mode") !== "apply";
  const r = await safe(async () => { const text = await file.text(); return stageAndValidate(file.name, text, toImportData(kind, text), dryRun); });
  return r.ok ? { report: r.data } : { error: r.error };
}
/** Step 2 (only for non-dry runs that validated): creates DRAFT curriculum. Publishing is a separate admin action. */
export async function applyImportAction(runId: string): Promise<ImportState> {
  const r = await safe(() => applyRun(runId));
  if (!r.ok) return { error: r.error };
  ["/syllabus", "/ncert", "/ssc", "/mapping", "/dashboard"].forEach((p) => revalidatePath(p));
  return { applied: r.data.applied as { ncert: number; ssc: number; mapping: number } };
}
