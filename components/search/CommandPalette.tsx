"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search, X, BookOpen, GraduationCap, StickyNote, Target, Link2, ListTodo } from "lucide-react";

const STUDY_KIND: Record<string, string> = { chapter: "ncert_chapter", ssc_topic: "ssc_topic", ssc_subtopic: "ssc_subtopic" };
interface Hit { kind: string; id: string; title: string; subtitle: string | null; href: string }
const GROUPS = [
  { label: "NCERT", kinds: ["book", "chapter", "concept"], icon: BookOpen },
  { label: "SSC", kinds: ["ssc_subject", "ssc_topic", "ssc_subtopic"], icon: GraduationCap },
  { label: "Notes", kinds: ["note"], icon: StickyNote },
  { label: "PYQs", kinds: ["pyq"], icon: Target },
  { label: "Resources", kinds: ["resource"], icon: Link2 },
  { label: "Tasks", kinds: ["task"], icon: ListTodo },
];
const KIND: Record<string, string> = { book: "Book", concept: "Concept", ssc_subject: "Subject", ssc_subtopic: "Subtopic" };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "error" | "auth">("idle");
  const [filter, setFilter] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } if (e.key === "Escape") setOpen(false); };
    const openIt = () => setOpen(true);
    window.addEventListener("keydown", key); document.addEventListener("open-search", openIt);
    return () => { window.removeEventListener("keydown", key); document.removeEventListener("open-search", openIt); };
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 30); }, [open]);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); setState("idle"); return; }
    const ctl = new AbortController(); setState("loading");
    const t = setTimeout(async () => {
      try { const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal }); if (r.status === 401) { setState("auth"); setHits([]); return; } if (!r.ok) throw new Error(); setHits((await r.json()).hits); setState("idle"); }
      catch (e: unknown) { if (!(e instanceof DOMException && e.name === "AbortError")) setState("error"); }
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  if (!open) return null;
  const close = () => setOpen(false);
  const shown = GROUPS.map((g) => ({ ...g, items: hits.filter((h) => g.kinds.includes(h.kind)) })).filter((g) => g.items.length && (!filter || g.label === filter));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:px-4 lg:pt-[12vh]" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label="Search" onClick={(e) => e.stopPropagation()}
        className="mx-auto flex h-full w-full max-w-xl flex-col border-line bg-raised/95 backdrop-blur lg:h-auto lg:max-h-[70vh] lg:rounded-[24px] lg:border">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 text-mute" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search anything..." aria-label="Search" className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-mute" />
          <button onClick={close} aria-label="Close search" className="grid h-10 w-10 place-items-center rounded-ctl text-sub hover:bg-surface"><X className="h-5 w-5" /></button>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3">
          {GROUPS.map((g) => <button key={g.label} aria-pressed={filter === g.label} onClick={() => setFilter(filter === g.label ? null : g.label)} className={`chip min-h-[32px] ${filter === g.label ? "chip-on" : ""}`}>{g.label}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {q.trim().length < 2 && <p className="px-3 py-8 text-center text-sm text-mute">Type at least 2 characters. Searches books, chapters, concepts, SSC topics, notes, PYQs, resources and tasks.</p>}
          {state === "loading" && hits.length === 0 && <p className="px-3 py-8 text-center text-sm text-mute">Searching...</p>}
          {state === "auth" && <p role="alert" className="px-3 py-8 text-center text-sm text-red-400">Your session expired. <Link href="/login" onClick={close} className="underline">Sign in again</Link>.</p>}
          {state === "error" && <p role="alert" className="px-3 py-8 text-center text-sm text-red-400">Search failed. Check your connection and try again.</p>}
          {state === "idle" && q.trim().length >= 2 && shown.length === 0 && <p className="px-3 py-8 text-center text-sm text-mute">No results for &ldquo;{q}&rdquo;.</p>}
          {shown.map((g) => (
            <section key={g.label} className="mb-2"><h3 className="flex items-center gap-2 px-3 py-2 text-xs text-mute"><g.icon className="h-3.5 w-3.5" />{g.label}</h3>
              <ul>{g.items.map((h) => (
                <li key={h.kind + h.id} className="flex items-center"><Link href={h.href} onClick={close} className="block min-h-[44px] min-w-0 flex-1 rounded-ctl px-3 py-2 hover:bg-surface focus-visible:bg-surface">
                  <p className="truncate text-sm">{h.title}</p>{h.subtitle && <p className="truncate text-xs text-mute">{KIND[h.kind] ? `${KIND[h.kind]} · ${h.subtitle}` : h.subtitle}</p>}
                </Link>{STUDY_KIND[h.kind] && <Link href={`/study/${STUDY_KIND[h.kind]}/${h.id}`} onClick={close} aria-label={`Study ${h.title}`} className="grid min-h-[44px] shrink-0 place-items-center px-3 text-sm text-lime">Study</Link>}</li>))}</ul></section>
          ))}
        </div>
      </div>
    </div>
  );
}
