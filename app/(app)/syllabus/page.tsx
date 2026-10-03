import Link from "next/link";
import { Layers, SearchX, Upload, Plus, ChevronRight } from "lucide-react";
import { getSyllabus, getFilterOptions } from "@/services/curriculum";
import { currentIsAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SyllabusFilters } from "@/components/syllabus/SyllabusFilters";
import { ItemCard } from "@/components/syllabus/ItemCard";
import { parseSyllabusFilters } from "@/lib/filters";
import type { SyllabusItem } from "@/types/curriculum";

type SP = Record<string, string | undefined>;
export default async function Syllabus({ searchParams: sp }: { searchParams: SP }) {
  const f = parseSyllabusFilters(sp);
  const filtered = Object.values(f).some(Boolean);
  const [{ items, total, truncated }, options, admin] = await Promise.all([getSyllabus(f), getFilterOptions(), currentIsAdmin()]);
  const groups = new Map<string, SyllabusItem[]>();
  items.forEach((i) => groups.set(i.group, [...(groups.get(i.group) ?? []), i]));

  return (
    <div>
      <PageHeader title="Master Syllabus" subtitle="Everything you need. One place."
        actions={<>{admin && <Link href="/admin/import" className="btn-ghost" aria-label="Import curriculum"><Upload className="h-4 w-4" /><span className="hidden sm:inline">Import</span></Link>}<Link href="/syllabus/new" className="btn-primary" aria-label="Add topic"><Plus className="h-4 w-4" /><span className="hidden sm:inline">Add topic</span></Link></>} />
      <SyllabusFilters options={options} />
      {items.length === 0 ? (
        filtered
          ? <EmptyState icon={SearchX} title="Nothing matches these filters" hint="Loosen a filter or clear them all." action={{ href: "/syllabus", label: "Clear filters" }} />
          : <EmptyState icon={Layers} title="Your curriculum is waiting." hint="Import the verified NCERT and SSC dataset, or add your own topics to start." actions={[{ href: "/admin/import", label: "Import Curriculum" }, { href: "/syllabus/new", label: "Add Topic" }]} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-mute">{truncated ? `Showing ${items.length} of ${total}. Narrow with filters to see the rest.` : `${total} ${total === 1 ? "item" : "items"}`}</p>
          {Array.from(groups).map(([name, list], idx) => (
            <details key={name} open={filtered || idx === 0} className="group">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 rounded-ctl px-1 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 text-mute transition group-open:rotate-90" />
                <span className="flex-1 truncate font-medium">{name}</span><span className="text-xs text-mute">{list.length}</span>
              </summary>
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-3 pb-3 md:grid-cols-[repeat(2,minmax(0,1fr))]">{list.map((i) => <ItemCard key={i.kind + i.id} item={i} />)}</div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
