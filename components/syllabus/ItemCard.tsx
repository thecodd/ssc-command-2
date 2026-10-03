import Link from "next/link";
import { Link2, Clock } from "lucide-react";
import { Badge, relevanceTone, statusTone } from "@/components/ui/Badge";
import { Bar } from "@/components/ui/Ring";
import { PRIORITY_LABEL, RELEVANCE_LABEL, STATUS_LABEL } from "@/lib/format";
import { studyHref } from "@/lib/study/routes";
import type { SyllabusItem } from "@/types/curriculum";

export function ItemCard({ item }: { item: SyllabusItem }) {
  return (
    <article className="card relative block min-w-0 p-4 transition hover:border-mute focus-within:border-lime">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="font-medium leading-snug"><Link href={item.href} className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">{item.title}</Link></p><p className="mt-0.5 truncate text-xs text-mute">{item.meta}</p></div>
        <Badge tone={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Badge>
      </div>
      {item.connections.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-sub"><Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime" /><span className="line-clamp-2">{item.connections.join(" · ")}</span></p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge>{item.source}</Badge>
        {item.relevance && <Badge tone={relevanceTone(item.relevance)}>{RELEVANCE_LABEL[item.relevance]} relevance</Badge>}
        <Badge>{PRIORITY_LABEL[item.priority] ?? item.priority} priority</Badge>
        {item.estimated_minutes ? <span className="ml-auto flex items-center gap-1 text-xs text-mute"><Clock className="h-3 w-3" />{item.estimated_minutes}m</span> : null}
      </div>
      <div className="mt-3 flex items-center gap-3"><div className="flex-1"><Bar value={item.completion} /></div><span className="text-xs tabular-nums text-sub">{item.completion}%</span>
        <Link href={studyHref(item.kind === "ncert" ? "ncert_chapter" : "ssc_topic", item.id)} className="relative z-10 grid min-h-[44px] place-items-center rounded-ctl px-3 text-sm text-lime hover:bg-raised">Study</Link></div>
    </article>
  );
}
