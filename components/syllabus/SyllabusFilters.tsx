"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { PRIORITY_LABEL, RELEVANCE_LABEL, STATUS_LABEL } from "@/lib/format";

interface Opts { classes: number[]; subjects: string[]; topics: { id: string; title: string }[] }
const sel = "min-h-[44px] w-full rounded-ctl border border-line bg-surface px-3 text-sm outline-none focus:border-lime";
const FILTER_KEYS = ["cls", "subject", "topic", "relevance", "priority", "status"] as const;
const ALL_KEYS = ["q", "source", ...FILTER_KEYS] as const;
type Vals = Record<string, string>;
const read = (sp: URLSearchParams): Vals => Object.fromEntries(ALL_KEYS.map((k) => [k, sp.get(k) ?? ""]));
const toQuery = (v: Vals) => { const p = new URLSearchParams(); ALL_KEYS.forEach((k) => v[k] && p.set(k, v[k])); return p.toString(); };

function Field({ vals, update, k, label, all, children }: { vals: Vals; update: (p: Vals) => void; k: string; label: string; all: string; children: React.ReactNode }) {
  return (
    <label className="block"><span className="sr-only">{label}</span>
      <select className={sel} value={vals[k]} onChange={(e) => update({ [k]: e.target.value })}><option value="">{all}</option>{children}</select></label>
  );
}

/**
 * Race-safe URL state. `ref` is the single source of truth for the *intended* filters: every change is merged into it
 * synchronously, so a debounced search push can never overwrite a newer filter (and a filter push always carries the latest q).
 * The URL is only adopted back into state when it changes from outside (back/forward, link) — not when it echoes our own push.
 */
export function SyllabusFilters({ options }: { options: Opts }) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Vals>(() => read(new URLSearchParams(sp.toString())));
  const ref = useRef<Vals>(vals);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushed = useRef<string[]>([]);

  const push = () => {
    timer.current = null;
    const qs = toQuery(ref.current);
    pushed.current = [...pushed.current.slice(-9), qs];
    start(() => router.replace(qs ? `${path}?${qs}` : path, { scroll: false }));
  };
  const update = (patch: Vals, debounce = false) => {
    ref.current = { ...ref.current, ...patch };
    setVals(ref.current);
    if (timer.current) clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(push, 250); else push();
  };
  const clearAll = () => { ref.current = Object.fromEntries(ALL_KEYS.map((k) => [k, ""])); setVals(ref.current); if (timer.current) clearTimeout(timer.current); push(); };

  useEffect(() => { // adopt external URL changes only
    const incoming = read(new URLSearchParams(sp.toString())), qs = toQuery(incoming);
    if (timer.current || pushed.current.includes(qs) || qs === toQuery(ref.current)) return;
    ref.current = incoming; setVals(incoming);
  }, [sp]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const active = FILTER_KEYS.filter((k) => vals[k]).length;
  const fields = (
    <>
      <Field vals={vals} update={update} k="cls" label="Class" all="All classes">{options.classes.map((c) => <option key={c} value={c}>Class {c}</option>)}</Field>
      <Field vals={vals} update={update} k="subject" label="Subject" all="All subjects">{options.subjects.map((s) => <option key={s}>{s}</option>)}</Field>
      <Field vals={vals} update={update} k="topic" label="SSC topic" all="Any SSC topic">{options.topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Field>
      <Field vals={vals} update={update} k="relevance" label="Relevance" all="Any relevance">{Object.entries(RELEVANCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Field>
      <Field vals={vals} update={update} k="priority" label="Priority" all="Any priority">{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Field>
      <Field vals={vals} update={update} k="status" label="Status" all="Any status">{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Field>
    </>
  );

  return (
    <div className="mb-5 space-y-3">
      <div className="flex gap-2">
        <label className="relative flex-1"><span className="sr-only">Search syllabus</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
          <input value={vals.q} onChange={(e) => update({ q: e.target.value }, true)} placeholder="Search chapters and topics" className={`${sel} pl-10`} /></label>
        <button onClick={() => setOpen(true)} className="btn-ghost relative lg:hidden" aria-label="Open filters"><SlidersHorizontal className="h-4 w-4" />{active > 0 && <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-lime text-[11px] font-semibold text-black">{active}</span>}</button>
      </div>
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0" role="group" aria-label="Source">
        {[["", "All"], ["ncert", "NCERT"], ["ssc", "SSC"]].map(([v, l]) => (
          <button key={v} onClick={() => update({ source: v })} aria-pressed={vals.source === v} className={`chip min-h-[36px] px-4 text-sm ${vals.source === v ? "chip-on" : ""}`}>{l}</button>
        ))}
        {(active > 0 || vals.q || vals.source) && <button onClick={clearAll} className="chip min-h-[36px] px-3 text-sm">Clear all</button>}
      </div>
      <div className="hidden grid-cols-6 gap-2 lg:grid">{fields}</div>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Filters" onClick={(e) => e.stopPropagation()} className="max-h-[85dvh] w-full space-y-2 overflow-y-auto rounded-t-[24px] border border-line bg-raised p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            <div className="mb-1 flex items-center justify-between"><h2 className="text-lg font-semibold">Filters</h2><button onClick={() => setOpen(false)} aria-label="Close filters" className="grid h-10 w-10 place-items-center rounded-ctl hover:bg-surface"><X className="h-5 w-5" /></button></div>
            {fields}
            <div className="flex gap-2 pt-2"><button className="btn-ghost flex-1" onClick={clearAll}>Clear all</button><button className="btn-primary flex-1" onClick={() => setOpen(false)}>Show results</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
