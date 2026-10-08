import Link from "next/link";
import { ShieldAlert, Upload, Link2 } from "lucide-react";
import { currentIsAdmin } from "@/lib/auth";
import { listPublishing, type PublishRow } from "@/services/admin";
import { STATUS_LABEL } from "@/lib/admin/publish";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { PublishControls } from "@/components/admin/PublishControls";
export const dynamic = "force-dynamic";
function Section({ id, title, rows }: { id: string; title: string; rows: PublishRow[] }) {
  return (
    <section aria-labelledby={id}><h2 id={id} className="mb-3 font-semibold">{title} <span className="text-sm font-normal text-mute">({rows.length})</span></h2>
      {rows.length === 0 ? <p className="text-sm text-sub">Nothing here yet. Import a file to create a draft.</p> : (
        <ul className="space-y-3">{rows.map((r) => (
          <li key={r.id} className="card p-4">
            <p className="font-medium">{r.title}</p>
            <p className="mt-0.5 text-sm text-sub"><span>Status: {STATUS_LABEL[r.status]}</span>{r.subtitle && <> · {r.subtitle}</>}</p>
            <p className="text-xs text-mute">{r.sourceName ? `Source: ${r.sourceName} (${r.sourceVerified ? "verified" : "not verified"})` : "No source set. A source is required before publishing."}{r.kind === "ssc_exam" && ` · ${r.official ? "Official" : "Not marked official"}`}</p>
            <PublishControls row={r} />
          </li>))}</ul>)}
    </section>);
}
export default async function AdminHome() {
  if (!(await currentIsAdmin())) return <div><PageHeader title="Admin" /><EmptyState icon={ShieldAlert} title="Admins only" hint="Only admins can publish or change the official curriculum. You can still add your own topics." action={{ href: "/syllabus/new", label: "Add Topic" }} /></div>;
  const rows = await listPublishing();
  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Admin" subtitle="Review imported curriculum and publish it. Learners only see published content."
        actions={<><Link href="/admin/import" className="btn-ghost"><Upload className="h-4 w-4" aria-hidden />Import</Link><Link href="/mapping" className="btn-ghost"><Link2 className="h-4 w-4" aria-hidden />Mappings</Link></>} />
      <Section id="books-h" title="NCERT books" rows={rows.filter((r) => r.kind === "book")} />
      <Section id="exams-h" title="SSC exam versions" rows={rows.filter((r) => r.kind === "ssc_exam")} />
    </div>);
}
