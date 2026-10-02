"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { addActions } from "@/lib/nav";
export function AddSheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Add" aria-haspopup="dialog"
        className="fixed bottom-[76px] right-4 z-30 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-lime/90 text-black shadow-lg backdrop-blur transition active:scale-95 lg:bottom-8 lg:right-8">
        <Plus className="h-6 w-6" />
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 lg:items-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Add" onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-[24px] border border-line bg-raised p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:rounded-[24px]">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Add</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-ctl hover:bg-surface"><X className="h-5 w-5" /></button></div>
            <ul className="grid gap-2">
              {addActions.map((a) => (
                <li key={a.href}><Link href={a.href} onClick={() => setOpen(false)} className="btn-ghost w-full justify-start">{a.label}</Link></li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
