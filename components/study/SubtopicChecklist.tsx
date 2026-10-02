"use client";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { studyHref } from "@/lib/study/routes";
import type { StudySubtopic } from "@/types/study";
import { useStudy } from "./StudyProvider";
/** Subtopics of the current topic. Ticking one is a progress write (set_progress); each can also be studied on its own. */
export function SubtopicChecklist({ items }: { items: StudySubtopic[] }) {
  const { api, mutate, pendingKeys } = useStudy();
  return (
    <ul className="divide-y divide-line">
      {items.map((s) => {
        const done = s.lifecycle === "completed", key = `sub:${s.id}`;
        return (
          <li key={s.id} className="flex items-center">
            <button type="button" aria-pressed={done} aria-label={`${s.title}: ${done ? "completed" : "not completed"}`} disabled={pendingKeys.has(key)}
              onClick={() => void mutate(key, () => api.setProgress("ssc_subtopic", s.id, { status: done ? "learning" : "completed" }))}
              className="grid h-11 w-11 shrink-0 place-items-center disabled:opacity-60">{done ? <Check className="h-5 w-5 text-lime" aria-hidden /> : <Circle className="h-5 w-5 text-mute" strokeWidth={1.5} aria-hidden />}</button>
            <Link href={studyHref("ssc_subtopic", s.id)} className={`min-h-[44px] flex-1 py-3 text-sm hover:text-lime ${done ? "text-sub line-through" : ""}`}>{s.title}</Link>
          </li>
        );
      })}
    </ul>
  );
}
