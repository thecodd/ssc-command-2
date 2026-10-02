import type { EntityType } from "@/types/curriculum";
import { practiceNewHref } from "@/lib/practice/routes";
// Study Mode is addressed by the existing entity model: /study/<entity_type>/<uuid>. No separate "study item" concept exists.
export const STUDY_TYPES: readonly EntityType[] = ["ncert_chapter", "ssc_topic", "ssc_subtopic"];
export const parseStudyType = (v: string | undefined): EntityType | null => (STUDY_TYPES as readonly string[]).includes(v ?? "") ? (v as EntityType) : null;
export const studyHref = (type: EntityType, id: string) => `/study/${type}/${id}`;
/** The regular (non-focus) detail page for an item. Subtopics have no page of their own, so they open their parent topic. */
export function detailHref(type: EntityType, id: string, parentTopicId?: string | null): string {
  if (type === "ncert_chapter") return `/ncert/chapter/${id}`;
  if (type === "ssc_topic") return `/ssc/topic/${id}`;
  return parentTopicId ? `/ssc/topic/${parentTopicId}` : "/ssc";
}
/** The question-practice screen exists (Phase 6): every "Practice" label in Study Mode follows this flag. */
export const PRACTICE_READY = true;
export const practiceVerb = PRACTICE_READY ? "Practice" : "Review";
/** Where "Practice PYQs" goes: the configure screen for a topic or subtopic. */
export const practiceHref = (scope: "ssc_topic" | "ssc_subtopic", id: string) => practiceNewHref(scope, id);
