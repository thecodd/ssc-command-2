import Link from "next/link";
import { Link2, ChevronRight, Plus } from "lucide-react";
import { getMappings, getMappingOptions } from "@/services/mappings";
import { currentIsAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ActionForm } from "@/components/ui/ActionForm";
import { fieldCls } from "@/components/ui/field";
import { MappingChain } from "@/components/curriculum/MappingChain";
import { MappingFields } from "@/components/curriculum/MappingFields";
import { createMappingAction } from "@/app/actions/admin";
import { MAPPING_LABEL } from "@/lib/format";
import { isUuid } from "@/lib/filters";

export default async function MappingPage({ searchParams: sp }: { searchParams: { type?: string; chapter?: string; topic?: string } }) {
  const type = sp.type && sp.type in MAPPING_LABEL ? sp.type : undefined;
  const [{ mappings: maps, total, truncated }, admin] = await Promise.all([getMappings({ type, chapterId: isUuid(sp.chapter) ? sp.chapter : undefined, topicId: isUuid(sp.topic) ? sp.topic : undefined }), currentIsAdmin()]);
  const options = admin ? await getMappingOptions() : null;
  const chip = (on: boolean) => `chip min-h-[36px] whitespace-nowrap px-4 text-sm ${on ? "chip-on" : ""}`;
  return (
    <div>
      <PageHeader title="NCERT → SSC" subtitle="See which school foundations power which exam topics." />
      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <Link href="/mapping" className={chip(!type)}>All</Link>
        {Object.entries(MAPPING_LABEL).map(([k, v]) => <Link key={k} href={`/mapping?type=${k}`} className={chip(type === k)}>{v}</Link>)}
      </div>
      {admin && options && (
        <details className="card mb-5"><summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-2 px-4 [&::-webkit-details-marker]:hidden"><Plus className="h-4 w-4 text-lime" />Add mapping</summary>
          <div className="border-t border-line p-4">
            {options.chapters.length && options.topics.length ? (
              <ActionForm action={createMappingAction} submit="Create mapping">
                <label className="block text-sm text-sub">NCERT chapter<select name="ncert_chapter_id" required className={`${fieldCls} mt-1 text-ink`}>{options.chapters.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
                <label className="block text-sm text-sub">SSC topic<select name="ssc_topic_id" required className={`${fieldCls} mt-1 text-ink`}>{options.topics.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
                <MappingFields />
              </ActionForm>
            ) : <p className="text-sm text-sub">Import NCERT chapters and SSC topics before creating mappings.</p>}
          </div>
        </details>
      )}
      {maps.length === 0
        ? <EmptyState icon={Link2} title={type || sp.chapter || sp.topic ? "No mappings match" : "No mappings yet"} hint={admin ? "Create one above, or include mappings in your import file." : "Mappings appear here once an admin adds them. Not every NCERT chapter maps to SSC, and that's fine."} action={type ? { href: "/mapping", label: "Show all" } : admin ? { href: "/admin/import", label: "Import Curriculum" } : undefined} />
        : <>{truncated && <p className="mb-3 text-xs text-mute">Showing {maps.length} of {total} mappings. Filter by type to narrow.</p>}<ul className="grid gap-4 lg:grid-cols-2">{maps.map((m) => (
          <li key={m.id}><Link href={`/mapping/${m.id}`} className="block rounded-card transition hover:opacity-90">
            <MappingChain m={m} concepts={m.concepts} /><p className="mt-2 flex items-center justify-end gap-1 text-xs text-mute">Details <ChevronRight className="h-3 w-3" /></p></Link></li>))}</ul></>}
    </div>
  );
}
