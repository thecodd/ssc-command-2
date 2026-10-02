"use client";
import Link from "next/link";
import { Search } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
export function MobileBar() {
  return (
    <div className="sticky top-0 z-20 flex min-h-[56px] items-center justify-between border-b border-line bg-bg/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
      <Link href="/dashboard" aria-label="Home"><Logo /></Link>
      <button aria-label="Search" onClick={() => document.dispatchEvent(new CustomEvent("open-search"))} className="grid h-11 w-11 place-items-center rounded-ctl text-sub hover:bg-surface"><Search className="h-5 w-5" /></button>
    </div>
  );
}
