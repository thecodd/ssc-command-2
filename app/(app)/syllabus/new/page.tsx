import Link from "next/link";
import { ArrowLeft, GraduationCap } from "lucide-react";
import { getSscSubjectOptions } from "@/services/curriculum";
import { addTopicAction } from "@/app/actions/content";
import { ActionForm } from "@/components/ui/ActionForm";
import { fieldCls } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PRIORITY_LABEL } from "@/lib/format";

export default async function NewTopic() {
  const subjects = await getSscSubjectOptions();
  return (
    <div className="mx-auto max-w-lg">
      <Link href="/syllabus" className="mb-4 inline-flex min-h-[44px] items-center gap-1 text-sm text-sub"><ArrowLeft className="h-4 w-4" />Syllabus</Link>
      <PageHeader title="Add topic" subtitle="A custom topic only you can see." />
      {subjects.length === 0
        ? <EmptyState icon={GraduationCap} title="No SSC subjects yet" hint="Custom topics attach to an SSC subject. Import the SSC syllabus first." action={{ href: "/admin/import", label: "Import Curriculum" }} />
        : (
          <ActionForm action={addTopicAction} submit="Add topic">
            <label className="block text-sm text-sub">SSC subject<select name="subject_id" required className={`${fieldCls} mt-1 text-ink`}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
            <label className="block text-sm text-sub">Topic name<input name="title" required maxLength={160} className={`${fieldCls} mt-1 text-ink`} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm text-sub">Priority<select name="priority" defaultValue="medium" className={`${fieldCls} mt-1 text-ink`}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="block text-sm text-sub">Minutes<input name="estimated_minutes" type="number" min={5} max={2000} className={`${fieldCls} mt-1 text-ink`} /></label>
            </div>
          </ActionForm>
        )}
    </div>
  );
}
