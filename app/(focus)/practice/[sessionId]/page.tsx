import { notFound } from "next/navigation";
import { getPracticeState, getScopeInfo } from "@/services/practice";
import { PracticeRunner } from "@/components/practice/PracticeRunner";
import { parseSessionId } from "@/lib/practice/routes";
import { classifyError } from "@/lib/study/errors";
import { parseBackToReview } from "@/lib/revision/routes";

export const dynamic = "force-dynamic";
export default async function PracticeSessionPage({ params, searchParams }: { params: { sessionId: string }; searchParams: { back?: string } }) {
  const id = parseSessionId(params.sessionId);
  if (!id) notFound();
  let session;
  try { session = await getPracticeState(id); }          // another user's session looks like "not found" (SQL), so it is a 404 here too
  catch (e) { if (classifyError(e) === "not_found") notFound(); throw e; }
  const info = (session.scope_id || session.scope_type === "weak" || session.scope_type === "mixed" ? await getScopeInfo(session.scope_type, session.scope_id).catch(() => null) : null)
    ?? { title: "Practice", kicker: "Practice", backHref: "/study", backLabel: "Back to Study" };
  const back = parseBackToReview(searchParams.back);
  return <PracticeRunner session={session} info={back ? { ...info, backHref: back, backLabel: "Back to revision" } : info} returnToReview={!!back} />;
}
