"use client";
import { useStudy } from "./StudyProvider";
/** Renders ONLY when the screen is driven by the in-memory fixture API, so mock output can never pass as real data. */
export function FixtureBanner() {
  const { api } = useStudy();
  if (api.mode !== "fixture") return null;
  return <p role="note" className="border-b border-amber-400/40 bg-amber-400/10 px-4 py-2 text-center text-xs text-amber-200">FIXTURE DATA: development preview. Nothing here is real, and nothing is saved.</p>;
}
