import { notFound } from "next/navigation";
import { getPracticeOptions, getScopeInfo } from "@/services/practice";
import { PracticeConfig } from "@/components/practice/PracticeConfig";
import { parseCount, parseNewParams } from "@/lib/practice/routes";
import { parseBackToReview } from "@/lib/revision/routes";
import { classifyError } from "@/lib/study/errors";

export const dynamic = "force-dynamic";
// Validate the URL BEFORE any query: unknown scope, missing/odd id, or an id on weak/mixed is a 404.
export default async function NewPractice({ searchParams }: { searchParams: { scope?: string; id?: string; back?: string; count?: string } }) {
  const p = parseNewParams(searchParams);
  if (!p) notFound();
  const back = parseBackToReview(searchParams.back);
  const base = await getScopeInfo(p.scope, p.id);
  if (!base) notFound();
  const info = back ? { ...base, backHref: back, backLabel: "Back to revision" } : base;
  let options;
  try { options = await getPracticeOptions(p.scope, p.id); }
  catch (e) { if (classifyError(e) === "not_found") notFound(); throw e; }
  return <PracticeConfig scope={p.scope} scopeId={p.id} info={info} options={options} backTo={back} initialCount={parseCount(searchParams.count)} />;
}
