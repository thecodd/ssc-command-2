"use client";
import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
/** Bottom sheet on phones, centred panel on larger screens. Built on the native <dialog>: focus is trapped, Esc closes, the page behind is inert. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="m-0 mt-auto max-h-[88dvh] w-full max-w-none overflow-y-auto rounded-b-none rounded-t-card border border-line bg-surface p-0 text-ink backdrop:bg-black/60 md:m-auto md:max-w-lg md:rounded-card">
      {open && (
        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 place-items-center rounded-ctl text-sub hover:bg-raised"><X className="h-5 w-5" /></button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
