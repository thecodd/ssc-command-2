"use client";
import { useState } from "react";
import { CalendarPlus, Check } from "lucide-react";
import { useStudy } from "./StudyProvider";
export function AddToFocus({ title }: { title: string }) {
  const { api, type, id } = useStudy();
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <button type="button" disabled={busy} className="btn-ghost w-full disabled:opacity-60" onClick={async () => {
        if (busy) return; setBusy(true);
        const r = await api.addFocus(type, id, title);
        setBusy(false);
        setState(r.ok ? { ok: true, text: r.data.already ? "Already in today's focus" : "Added to today's focus" } : { ok: false, text: r.error });
      }}>{state?.ok ? <Check className="h-4 w-4 text-lime" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />}Add to today&apos;s focus</button>
      {state && <p role={state.ok ? "status" : "alert"} className={`mt-1.5 text-xs ${state.ok ? "text-lime" : "text-red-400"}`}>{state.text}</p>}
    </div>
  );
}
