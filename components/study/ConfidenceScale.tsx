"use client";
import { useId } from "react";
import { CONFIDENCE_LABEL } from "@/lib/learning/rules";
/** 1-5 self-rating as a real radio group. The meaning of the chosen level is spelled out; nothing to fill in before studying. */
export function ConfidenceScale({ value, onPick, disabled, legend = "How confident are you?" }: { value: number | null; onPick: (n: number) => void; disabled?: boolean; legend?: string }) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0">
      <legend className="mb-2 text-sm text-sub">{legend}</legend>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="flex-1 cursor-pointer">
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onPick(n)} className="peer sr-only" />
            <span className="grid h-11 place-items-center rounded-ctl border border-line text-sm text-sub transition peer-checked:border-lime peer-checked:bg-lime-dim peer-checked:text-lime peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-lime peer-disabled:opacity-60">{n}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 min-h-[1.25rem] text-xs text-sub" aria-live="polite">{value ? `${value} · ${CONFIDENCE_LABEL[value]}` : "1 = not yet · 5 = I can do it on my own"}</p>
    </fieldset>
  );
}
