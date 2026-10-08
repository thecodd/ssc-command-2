import Link from "next/link";
import { Search as SearchIcon, SearchX } from "lucide-react";
import { searchPage, type SearchHit } from "@/services/search";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { fieldCls } from "@/components/ui/field";
export const dynamic = "force-dynamic";
const GROUPS: { label: string; kinds: string[] }[] = [
  { label: "NCERT", kinds: ["book", "chapter", "concept"] }, { label: "SSC", kinds: ["ssc_subject", "ssc_topic", "ssc_subtopic"] }, { label: "PYQs", kinds: ["pyq"] },
  { label: "Notes", kinds: ["note"] }, { label: "Resources", kinds: ["resource"] }, { label: "Tasks", kinds: ["task"] },
];
const STUDY: Record<string, string> = { chapter: "ncert_chapter", ssc_topic: "ssc_topic", ssc_subtopic: "ssc_subtopic" };
export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim().slice(0, 80); const hits: SearchHit[] = q.length >= 2 ? await searchPage(q) : [];
  const groups = GROUPS.map((g) => ({ ...g, items: hits.filter((h) => g.kinds.includes(h.kind)) })).filter((g) => g.items.length);
  return (
    <div>
      <PageHeader title="Search" subtitle="Chapters, concepts, SSC topics, PYQs, and your notes, resources and tasks. Tip: Ctrl/Cmd + K anywhere." />
      <form role="search" className="mb-6"><label className="relative block"><span className="sr-only">Search</span><SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" aria-hidden />
        <input name="q" type="search" defaultValue={q} autoFocus placeholder="Search everything" className={`${fieldCls} pl-10`} /></label></form>
      {q.length < 2 ? <p className="text-sm text-sub">Type at least two characters.</p> : !groups.length ? <EmptyState icon={SearchX} title={`Nothing found for “${q}”`} hint="Try a shorter word, or the start of a word." /> : (
        <div className="space-y-8">{groups.map((g) => (
          <section key={g.label} aria-label={g.label}><h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-mute">{g.label} <span className="normal-case tracking-normal">({g.items.length})</span></h2>
            <ul className="card divide-y divide-line">{g.items.map((h) => (
              <li key={h.kind + h.id} className="flex items-center"><Link href={h.href} className="block min-h-[52px] min-w-0 flex-1 px-4 py-2.5 hover:bg-raised"><span className="block truncate">{h.title}</span>{h.subtitle && <span className="block truncate text-xs text-mute">{h.subtitle}</span>}</Link>
                {STUDY[h.kind] && <Link href={`/study/${STUDY[h.kind]}/${h.id}`} aria-label={`Study ${h.title}`} className="grid min-h-[44px] shrink-0 place-items-center px-4 text-sm text-lime">Study</Link>}</li>))}</ul>
          </section>))}</div>)}
    </div>);
}
