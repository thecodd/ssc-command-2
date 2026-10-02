import { isUuid } from "@/lib/filters";
// /revision                queue (what should I revise now?)
// /revision/<scheduleId>   focused review of ONE open revision (the id is revision_schedule.id)
export const revisionHref = (scheduleId: string) => `/revision/${scheduleId}`;
export const parseReviewId = (v: string | undefined) => (isUuid(v) ? v : null);
/** Where practice may send the learner back to after a mini-session: only a revision review page, never an arbitrary URL. */
export const parseBackToReview = (v: string | undefined | null): string | null => (v && /^\/revision\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null);
