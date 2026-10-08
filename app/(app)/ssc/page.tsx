import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { getExams, getExamOverview } from "@/services/ssc";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Ring";

export default async function Ssc({ searchParams: sp }: { searchParams: { exam?: string; tier?: string } }) {
  const exams = await getExams();
  if (!exams.length) return <div><PageHeader title="SSC CGL" /><EmptyState icon={GraduationCap} title="No SSC syllabus yet" hint="Import a verified exam version to start drilling into subjects and topics." actions={[{ href: "/admin/import", label: "Import Curriculum" }, { href: "/syllabus/new", label: "Add Topic" }]} /></div>;
  const exam = exams.find((e) => e.id === sp.exam) ?? exams[0];
  const ov = await getExamOverview(exam.id, sp.tier);
  const chip = (on: boolean) => `chip min-h-[44px] whitespace-nowrap px-4 text-sm ${on ? "chip-on" : ""}`;
  return (
    <div>
      <PageHeader title="SSC CGL" subtitle="Pick a subject. Drill into topics. Know what to do next." />
      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0" aria-label="Exam version">
        {exams.map((e) => <Link key={e.id} href={`/ssc?exam=${e.id}`} aria-current={e.id === exam.id ? "page" : undefined} className={chip(e.id === exam.id)}>{e.name} {e.exam_version}</Link>)}
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {exam.is_official ? <Badge tone="lime">Official syllabus</Badge> : <Badge>Unverified — not an official notification</Badge>}
        {exam.notification_url && <a href={exam.notification_url} target="_blank" rel="noreferrer" className="text-xs text-lime">Source</a>}
      </div>
      {ov.tiers.length > 0 && (
        <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0" aria-label="Tier">
          {ov.tiers.map((t) => <Link key={t.id} href={`/ssc?exam=${exam.id}&tier=${t.id}`} className={chip(t.id === ov.tierId)}>{t.name}</Link>)}
        </div>
      )}
      {ov.subjects.length === 0
        ? <EmptyState icon={GraduationCap} title="No subjects in this tier" hint="Import subjects and topics for this exam version." action={{ href: "/admin/import", label: "Import Curriculum" }} />
        : <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3">{ov.subjects.map((s) => (
          <li key={s.id}><Link href={`/ssc/subject/${s.id}`} className="card flex h-full min-h-[132px] flex-col justify-between p-5 transition hover:border-mute">
            <div><p className="text-lg font-semibold leading-snug">{s.name}</p><p className="mt-1 text-sm text-sub">{s.topicCount} {s.topicCount === 1 ? "topic" : "topics"}</p></div>
            <div className="mt-4 flex items-center gap-3"><div className="flex-1"><Bar value={s.percent} /></div><span className="text-xs tabular-nums text-sub">{s.percent}%</span></div>
          </Link></li>))}</ul>}
    </div>
  );
}
