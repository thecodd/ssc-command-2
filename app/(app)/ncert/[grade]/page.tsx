import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";
import { getClasses, getClassTree } from "@/services/ncert";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ClassPicker } from "@/components/curriculum/ClassPicker";
import { Badge, relevanceTone } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Ring";
import { RELEVANCE_LABEL } from "@/lib/format";

export default async function ClassPage(props: { params: Promise<{ grade: string }> }) {
  const params = await props.params;
  const grade = Number(params.grade);
  if (!Number.isInteger(grade) || grade < 6 || grade > 12) notFound();
  const [classes, tree] = await Promise.all([getClasses(), getClassTree(grade)]);
  return (
    <div><PageHeader title={`NCERT Class ${grade}`} />
      <ClassPicker grades={classes.map((c) => c.grade)} selected={grade} />
      {!tree || tree.subjects.length === 0
        ? <EmptyState icon={BookOpen} title={`No Class ${grade} content yet`} hint="Import chapters for this class to see them here." action={{ href: "/admin/import", label: "Import Curriculum" }} />
        : <div className="space-y-8">{tree.subjects.map((s: any) => (
          <section key={s.id}><h2 className="mb-3 text-xl font-semibold">{s.name}</h2>
            <div className="space-y-5">{s.books.map((b: any) => (
              <div key={b.id}><p className="mb-2 text-sm text-sub">{b.title}{b.edition ? ` · ${b.edition}` : ""}{b.academic_year ? ` · ${b.academic_year}` : ""}</p>
                {b.chapters.length === 0 ? <p className="text-sm text-mute">No chapters in this book yet.</p> :
                  <ul className="grid gap-2 md:grid-cols-2">{b.chapters.map((c: any) => (
                    <li key={c.id}><Link href={`/ncert/chapter/${c.id}`} className="card block p-4 transition hover:border-mute">
                      <div className="flex items-start justify-between gap-3"><p className="min-w-0 font-medium leading-snug">{c.number != null && <span className="mr-2 text-mute tabular-nums">{c.number}.</span>}{c.title}</p><Badge tone={relevanceTone(c.relevance)}>{RELEVANCE_LABEL[c.relevance]}</Badge></div>
                      <div className="mt-3 flex items-center gap-3"><div className="flex-1"><Bar value={c.progress.completion} /></div><span className="text-xs tabular-nums text-sub">{c.progress.completion}%</span></div>
                    </Link></li>))}</ul>}
              </div>))}</div>
          </section>))}</div>}
    </div>
  );
}
