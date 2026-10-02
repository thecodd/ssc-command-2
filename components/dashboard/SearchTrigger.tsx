"use client";
import { Search } from "lucide-react";
export function SearchTrigger() {
  return (
    <button className="flex min-h-[52px] w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-left text-sm text-mute transition hover:border-mute"
      onClick={() => document.dispatchEvent(new CustomEvent("open-search"))}>
      <Search className="h-4 w-4" /><span className="flex-1">Search your preparation...</span>
      <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 text-[11px] lg:block">Ctrl K</kbd>
    </button>
  );
}
