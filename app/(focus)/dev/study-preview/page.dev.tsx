import Link from "next/link";
import { notFound } from "next/navigation";
// DEV ONLY. Renders Study Mode against tests/fixtures (fake data, in-memory fake API).
// Named page.dev.tsx: next.config.mjs registers that extension only outside production, so this file is not part of any production build.
export default async function StudyPreview({ searchParams }: { searchParams: { scenario?: string } }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { FIXTURES, SCENARIOS } = await import("@/tests/fixtures/study");
  const { FixturePreview } = await import("@/tests/fixtures/FixturePreview");
  const scenario = searchParams.scenario && searchParams.scenario in FIXTURES ? searchParams.scenario : SCENARIOS[0];
  return (
    <>
      <nav aria-label="Fixture scenarios" className="flex flex-wrap gap-2 border-b border-line p-3 text-xs">{SCENARIOS.map((s) => <Link key={s} href={`/dev/study-preview?scenario=${s}`} className={`rounded border px-2 py-1 ${s === scenario ? "border-lime text-lime" : "border-line"}`}>{s}</Link>)}</nav>
      <FixturePreview key={scenario} initial={FIXTURES[scenario]} scenario={scenario} />
    </>
  );
}
