"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { studyHref } from "@/lib/study/routes";
import { completeAction, setProgressAction } from "@/app/actions/progress";
export function SubtopicList({ items, path }: { items: { id: string; title: string; status: string }[]; path: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const toggle = (i: { id: string; status: string }) => start(async () => {
    setErr(null);
    const done = i.status === "completed";
    const r = done ? await setProgressAction("ssc_subtopic", i.id, { status: "learning" }, path) : await completeAction("ssc_subtopic", i.id, path);
    if (!r.ok) setErr(r.error);
  });
  return (
    <div>
      <ul className="divide-y divide-line">
        {items.map((i) => { const done = i.status === "completed"; return (
          <li key={i.id} className="flex items-center"><button disabled={pending} onClick={() => toggle(i)} aria-pressed={done} className="flex min-h-[52px] flex-1 items-center gap-3 text-left">
            {done ? <Check className="h-5 w-5 shrink-0 text-lime" /> : <Circle className="h-5 w-5 shrink-0 text-mute" strokeWidth={1.5} />}
            <span className={done ? "text-sub line-through" : ""}>{i.title}</span></button>
            <Link href={studyHref("ssc_subtopic", i.id)} className="grid min-h-[44px] shrink-0 place-items-center px-3 text-sm text-lime">Study</Link></li>); })}
      </ul>
      {err && <p role="alert" className="mt-2 text-sm text-red-400">{err}</p>}
    </div>
  );
}
