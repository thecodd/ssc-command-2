import Link from "next/link";
export function Tabs({ tabs, active, base }: { tabs: { id: string; label: string }[]; active: string; base: string }) {
  return (
    <nav aria-label="Sections" className="no-scrollbar -mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 lg:mx-0 lg:px-0">
      {tabs.map((t) => (
        <Link key={t.id} aria-current={t.id === active ? "page" : undefined} scroll={false} href={`${base}?tab=${t.id}`}
          className={`-mb-px min-h-[44px] whitespace-nowrap border-b-2 px-3 py-3 text-sm transition ${t.id === active ? "border-lime text-ink" : "border-transparent text-sub hover:text-ink"}`}>{t.label}</Link>
      ))}
    </nav>
  );
}
