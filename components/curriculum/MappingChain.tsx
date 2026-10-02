import { Badge, relevanceTone } from "@/components/ui/Badge";
import { MAPPING_LABEL, RELEVANCE_LABEL } from "@/lib/format";
import type { Mapping } from "@/types/curriculum";

/** NCERT chapter/concepts ↓ SSC topic/subtopics ↓ PYQs — the signature relationship view. */
export function MappingChain({ m, concepts = [], subtopics = [], pyqCount }: { m: Mapping; concepts?: string[]; subtopics?: string[]; pyqCount?: number }) {
  const Chips = ({ list }: { list: string[] }) => list.length ? <div className="mt-2 flex flex-wrap gap-1.5">{list.slice(0, 8).map((c) => <span key={c} className="chip">{c}</span>)}{list.length > 8 && <span className="chip">+{list.length - 8}</span>}</div> : null;
  return (
    <div>
      <div className="rounded-card border border-line bg-surface p-4">
        <p className="text-xs text-mute">NCERT · Class {m.chapter.grade} · {m.chapter.subject}</p>
        <p className="mt-1 font-medium">{m.chapter.title}</p><Chips list={concepts} />
      </div>
      <div className="ml-6 flex items-center gap-3 py-2" aria-hidden>
        <span className="h-8 w-px bg-lime/60" />
        <span className="flex flex-wrap items-center gap-1.5"><Badge tone={relevanceTone(m.relevance)}>{RELEVANCE_LABEL[m.relevance]}</Badge><Badge>{MAPPING_LABEL[m.type]}</Badge></span>
      </div>
      <div className="rounded-card border border-lime/30 bg-lime-dim p-4">
        <p className="text-xs text-lime">{m.topic.exam} · {m.topic.tier} · {m.topic.subject}</p>
        <p className="mt-1 font-medium">{m.topic.title}</p><Chips list={subtopics} />
      </div>
      {pyqCount !== undefined && (<><div className="ml-6 py-2" aria-hidden><span className="block h-6 w-px bg-line" /></div>
        <p className="rounded-card border border-line px-4 py-3 text-sm text-sub">{pyqCount > 0 ? `${pyqCount} previous-year ${pyqCount === 1 ? "question" : "questions"} test this topic` : "No PYQs linked to this topic yet"}</p></>)}
    </div>
  );
}
