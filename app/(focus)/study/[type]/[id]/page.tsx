import { notFound } from "next/navigation";
import { getStudyContext } from "@/services/studyContext";
import { StudyScreen } from "@/components/study/StudyScreen";
import { parseStudyType } from "@/lib/study/routes";
import { isUuid } from "@/lib/filters";

export const dynamic = "force-dynamic";
// Validate BEFORE touching the database: unsupported types and malformed ids are a 404, never a query.
export default async function StudyPage({ params }: { params: { type: string; id: string } }) {
  const type = parseStudyType(params.type);
  if (!type || !isUuid(params.id)) notFound();
  const ctx = await getStudyContext(type, params.id);
  if (!ctx) notFound();
  return <StudyScreen ctx={ctx} />;
}
