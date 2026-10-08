import { ShieldAlert, Download } from "lucide-react";
import { currentIsAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ImportForm } from "@/components/admin/ImportForm";

export default async function ImportPage() {
  if (!(await currentIsAdmin())) return <div><PageHeader title="Import curriculum" /><EmptyState icon={ShieldAlert} title="Admins only" hint="Only admins can change the official curriculum. You can still add your own topics." action={{ href: "/syllabus/new", label: "Add Topic" }} /></div>;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Import curriculum" subtitle="NCERT chapters, SSC topics and mappings from JSON or CSV." />
      <ImportForm />
      <section className="mt-8 space-y-3 text-sm text-sub">
        <h2 className="font-semibold text-ink">Format</h2>
        <p>Import in one file or several. Order inside a file doesn&apos;t matter, but a mapping needs its chapter and topic to exist, so they are processed after NCERT and SSC rows. Re-importing updates rows instead of duplicating them.</p>
        <p>CSV needs a <code className="text-ink">type</code> column (<code className="text-ink">source</code>, <code className="text-ink">ncert</code>, <code className="text-ink">ssc</code> or <code className="text-ink">mapping</code>) and exactly one <code className="text-ink">source</code> row with a <code className="text-ink">name</code>. Separate concepts with <code className="text-ink">|</code>.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <a href="/samples/import-sample.json" download className="btn-ghost"><Download className="h-4 w-4" />Sample JSON</a>
          <a href="/samples/import-sample.csv" download className="btn-ghost"><Download className="h-4 w-4" />Sample CSV</a>
        </div>
        <p className="text-mute">The samples are schema placeholders, not real curriculum. Replace them with verified data and set <code>source_url</code>, <code>edition</code> and <code>academic_year</code>.</p>
      </section>
    </div>
  );
}
