import { notFound } from "next/navigation";
// DEV ONLY (page.dev.tsx is only a route outside production builds). Review screen against fixtures and an in-memory fake API.
export default async function RevisionPreviewPage({ searchParams }: { searchParams: { scenario?: string } }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { RevisionPreview } = await import("@/tests/fixtures/RevisionPreview");
  return <RevisionPreview scenario={searchParams.scenario ?? "default"} />;
}
