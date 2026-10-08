import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/filters";
import { ArrowLeft, ChevronRight, Target } from "lucide-react";
import { getSubjectDetail } from "@/services/ssc";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Ring";
import { PRIORITY_LABEL, STATUS_LABEL, pct } from "@/lib/format";

export default async function SubjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isUuid(params.id)) notFound();
  const s = await getSubjectDetail(params.id);
  if (!s) notFound();
  const done = s.topics.filter((t: any) => t.progress.status === "completed").length;
  return (
    <div>
      <Link href={s.examId ? `/ssc?exam=${s.examId}&tier=${s.tierId}` : "/ssc"} className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-sub"><ArrowLeft className="h-4 w-4" />{s.exam} · {s.tier}</Link>
      <h1 className="text-3xl font-bold tracking-tight">{s.name}</h1>
      <p className="mt-1 text-sm text-sub">{done} of {s.topics.length} topics done</p>
      <div className="mb-6 mt-3 max-w-sm"><Bar value={pct(done, s.topics.length)} /></div>
      {s.topics.length === 0
        ? <EmptyState icon={Target} title="No topics here yet" hint="Add your own topic or import the verified syllabus." actions={[{ href: "/syllabus/new", label: "Add Topic" }, { href: "/admin/import", label: "Import Curriculum" }]} />
        : <ul className="space-y-2">{s.topics.map((t: any) => (
          <li key={t.id}><details className="group card">
            <summary className="flex min-h-[64px] cursor-pointer list-none items-center gap-3 px-4 [&::-webkit-details-marker]:hidden">
              <ChevronRight className={`h-4 w-4 shrink-0 text-mute transition group-open:rotate-90 ${t.subtopics.length ? "" : "invisible"}`} />
              <div className="min-w-0 flex-1"><p className="truncate font-medium">{t.title}</p>
                <p className="mt-0.5 text-xs text-mute">{t.pyqCount} PYQs · {PRIORITY_LABEL[t.priority] ?? t.priority} priority{t.subtopics.length ? ` · ${t.subtopics.length} subtopics` : ""}</p></div>
              <Badge tone={statusTone(t.progress.status)}>{STATUS_LABEL[t.progress.status]}</Badge>
            </summary>
            <div className="border-t border-line px-4 pb-4 pt-3">
              <div className="flex items-center gap-3"><div className="flex-1"><Bar value={t.progress.completion} /></div><span className="text-xs tabular-nums text-sub">{t.progress.completion}%</span></div>
              {t.subtopics.length > 0 && <ul className="mt-3 space-y-1.5 text-sm text-sub">{t.subtopics.map((st: any) => <li key={st.id}>· {st.title}</li>)}</ul>}
              <Link href={`/ssc/topic/${t.id}`} className="btn-ghost mt-4 w-full">Open topic</Link>
            </div>
          </details></li>))}</ul>}
    </div>
  );
}
