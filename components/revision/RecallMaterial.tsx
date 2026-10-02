import Link from "next/link";
import { studyHref } from "@/lib/study/routes";
import type { StudyContext } from "@/types/study";
/** Compact support material shown AFTER the learner has tried to recall: names of the key ideas, the NCERT/SSC connection, their latest note. No article. */
export function RecallMaterial({ ctx }: { ctx: StudyContext }) {
  const e = ctx.entity;
  const points = e.type === "ncert_chapter" ? ctx.concepts : ctx.subtopics.map((s) => s.title);
  const links = (e.type === "ncert_chapter" ? ctx.sscTopics : ctx.foundation).slice(0, 3);
  const note = ctx.notes[0];
  return (
    <div className="space-y-5">
      <div><h3 className="mb-2 text-sm text-sub">{e.type === "ncert_chapter" ? "Key concepts" : "Subtopics to be able to explain"}</h3>
        {points.length ? <ul className="flex flex-wrap gap-1.5">{points.slice(0, 12).map((c, i) => <li key={i} className="chip text-sm text-ink">{c}</li>)}</ul> : <p className="text-sm text-mute">Nothing is listed for this item. Use your own notes, or open Study Mode.</p>}</div>
      {links.length > 0 && <div><h3 className="mb-2 text-sm text-sub">{e.type === "ncert_chapter" ? "Helps with (SSC)" : "NCERT foundation"}</h3>
        <ul className="space-y-1">{links.map((l) => <li key={l.id}><Link href={studyHref(l.type, l.id)} className="inline-flex min-h-[44px] items-center text-sm text-ink underline">{l.title}</Link></li>)}</ul></div>}
      {note && <div><h3 className="mb-2 text-sm text-sub">Your latest note</h3><p className="line-clamp-6 whitespace-pre-wrap rounded-ctl border border-line bg-surface p-3 text-sm text-sub">{note.title ? `${note.title}\n` : ""}{note.content}</p></div>}
    </div>
  );
}
