"use client";
import { useState, useTransition } from "react";
import { CalendarPlus, Check } from "lucide-react";
import { addFocusAction } from "@/app/actions/content";
import type { EntityType } from "@/types/curriculum";
export function FocusButton({ type, id, title }: { type: EntityType; id: string; title: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="contents">
      <button className="btn-ghost" disabled={pending} onClick={() => start(async () => { const r = await addFocusAction(type, id, title); setMsg(r.ok ? { ok: true, text: r.data.already ? "Already in today's focus" : "Added to today's focus" } : { ok: false, text: r.error }); })}>
        {msg?.ok ? <Check className="h-4 w-4 text-lime" /> : <CalendarPlus className="h-4 w-4" />}Add to today&apos;s focus
      </button>
      {msg && <span role="status" className={`w-full text-xs ${msg.ok ? "text-lime" : "text-red-400"}`}>{msg.text}</span>}
    </span>
  );
}
