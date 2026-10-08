// Publishing workflow for official curriculum containers (books, SSC exam versions). Mirrors the transitions the database enforces in 011
// (draft > in_review > published > archived); the database stays the authority, this only decides which buttons to offer.
export type PublishStatus = "draft" | "in_review" | "published" | "archived";
export type PublishKind = "book" | "ssc_exam";
export const PUBLISH_STATUSES: PublishStatus[] = ["draft", "in_review", "published", "archived"];
export const STATUS_LABEL: Record<PublishStatus, string> = { draft: "Draft", in_review: "In review", published: "Published", archived: "Archived" };
export const NEXT_STEPS: Record<PublishStatus, { to: PublishStatus; label: string }[]> = {
  draft: [{ to: "in_review", label: "Send for review" }, { to: "archived", label: "Archive" }],
  in_review: [{ to: "published", label: "Publish" }, { to: "draft", label: "Send back to draft" }, { to: "archived", label: "Archive" }],
  published: [{ to: "archived", label: "Archive" }],
  archived: [{ to: "published", label: "Restore" }],
};
export const isPublishStatus = (v: unknown): v is PublishStatus => typeof v === "string" && (PUBLISH_STATUSES as string[]).includes(v);
export const isPublishKind = (v: unknown): v is PublishKind => v === "book" || v === "ssc_exam";
export const canMove = (from: PublishStatus, to: PublishStatus) => NEXT_STEPS[from].some((s) => s.to === to);
