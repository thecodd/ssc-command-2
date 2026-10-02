import Link from "next/link";
import { Link2, Check } from "lucide-react";
import { Badge, relevanceTone } from "@/components/ui/Badge";
import { MAPPING_LABEL, RELEVANCE_LABEL } from "@/lib/format";
import { studyHref } from "@/lib/study/routes";
import type { Mapping } from "@/types/curriculum";

/** "Why this matters for SSC" block. side="ssc" shows the SSC topic; side="ncert" shows the NCERT chapter. */
export function ConnectionCard({ m, side = "ssc" }: { m: Mapping; side?: "ssc" | "ncert" }) {
  const href = side === "ssc" ? `/ssc/topic/${m.topic.id}` : `/ncert/chapter/${m.chapter.id}`;
  return (
    <div className="relative rounded-card border border-lime/25 bg-lime-dim p-4 transition hover:border-lime/50">
      <Link href={href} className="absolute inset-0 rounded-card" aria-label={side === "ssc" ? `Open ${m.topic.title}` : `Open ${m.chapter.title}`} />
      <p className="flex items-center gap-2 text-sm text-lime"><Link2 className="h-4 w-4" />{side === "ssc" ? "SSC connection" : "NCERT foundation"}</p>
      {side === "ssc"
        ? <p className="mt-2 font-medium">{m.topic.subject} <span className="text-mute">→</span> {m.topic.title}</p>
        : <p className="mt-2 font-medium">{m.chapter.title}<span className="block text-xs font-normal text-sub">Class {m.chapter.grade} · {m.chapter.subject}</span></p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={relevanceTone(m.relevance)}>{RELEVANCE_LABEL[m.relevance]} · {MAPPING_LABEL[m.type]}</Badge>
        {m.recommended && <span className="flex items-center gap-1 text-xs text-sub"><Check className="h-3 w-3 text-lime" />Recommended</span>}
      </div>
      {m.reason && <p className="mt-2 text-sm text-sub">{m.reason}</p>}
      <Link href={side === "ssc" ? studyHref("ssc_topic", m.topic.id) : studyHref("ncert_chapter", m.chapter.id)} className="relative z-10 mt-3 inline-flex min-h-[44px] items-center text-sm text-lime underline">Study this</Link>
    </div>
  );
}
