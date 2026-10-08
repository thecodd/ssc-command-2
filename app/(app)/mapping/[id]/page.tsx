import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/filters";
import { studyHref } from "@/lib/study/routes";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getMappingDetail } from "@/services/mappings";
import { currentIsAdmin } from "@/lib/auth";
import { MappingChain } from "@/components/curriculum/MappingChain";
import { MappingFields } from "@/components/curriculum/MappingFields";
import { ConnectionCard } from "@/components/curriculum/ConnectionCard";
import { ActionForm } from "@/components/ui/ActionForm";
import { updateMappingAction, deleteMappingAction } from "@/app/actions/admin";

export default async function MappingDetail(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!isUuid(params.id)) notFound();
  const [d, admin] = await Promise.all([getMappingDetail(params.id), currentIsAdmin()]);
  if (!d) notFound();
  const { mapping: m } = d;
  return (
    <div>
      <Link href="/mapping" className="mb-3 inline-flex min-h-[44px] items-center gap-1 text-sm text-sub"><ArrowLeft className="h-4 w-4" />Mapping</Link>
      <h1 className="text-3xl font-bold tracking-tight">{m.chapter.title} <span className="text-mute">→</span> {m.topic.title}</h1>
      {m.reason && <p className="mt-3 max-w-2xl text-sub">{m.reason}</p>}
      <div className="mt-6 max-w-xl"><MappingChain m={m} concepts={d.concepts} subtopics={d.subtopics} pyqCount={d.pyqCount} /></div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={studyHref("ncert_chapter", m.chapter.id)} className="btn-primary">Study the chapter</Link>
        <Link href={studyHref("ssc_topic", m.topic.id)} className="btn-primary">Study the SSC topic <ArrowRight className="h-4 w-4" /></Link>
        <Link href={`/ncert/chapter/${m.chapter.id}`} className="btn-ghost">Chapter details</Link>
        <Link href={`/ssc/topic/${m.topic.id}`} className="btn-ghost">Topic details</Link>
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section><h2 className="mb-1 font-semibold">NCERT → SSC</h2><p className="mb-3 text-sm text-sub">Everything &ldquo;{m.chapter.title}&rdquo; helps with.</p>
          <div className="space-y-3">{d.ncertToSsc.map((x) => <ConnectionCard key={x.id} m={x} side="ssc" />)}</div></section>
        <section><h2 className="mb-1 font-semibold">SSC → NCERT</h2><p className="mb-3 text-sm text-sub">Everything that supports &ldquo;{m.topic.title}&rdquo;.</p>
          <div className="space-y-3">{d.sscToNcert.map((x) => <ConnectionCard key={x.id} m={x} side="ncert" />)}</div></section>
      </div>
      {admin && (
        <section className="mt-10 max-w-xl space-y-6 border-t border-line pt-6"><h2 className="font-semibold">Manage mapping</h2>
          <ActionForm action={updateMappingAction} submit="Save changes"><input type="hidden" name="id" value={m.id} /><MappingFields d={{ type: m.type, relevance: m.relevance, reason: m.reason, recommended: m.recommended }} /></ActionForm>
          <ActionForm action={deleteMappingAction} submit="Delete mapping" danger><input type="hidden" name="id" value={m.id} /><p className="text-sm text-sub">Deleting removes only this link, not the chapter or topic.</p></ActionForm>
        </section>
      )}
    </div>
  );
}
