import Link from "next/link";
import { pad2 } from "@/lib/format";
export function ClassPicker({ grades, selected }: { grades: number[]; selected?: number }) {
  return (
    <nav aria-label="Class" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 py-1 lg:mx-0 lg:grid lg:grid-cols-7 lg:overflow-visible lg:px-0">
      {grades.map((g) => (
        <Link key={g} href={`/ncert/${g}`} aria-current={g === selected ? "page" : undefined}
          className={`flex h-16 min-w-[64px] flex-col items-center justify-center rounded-card border transition ${g === selected ? "border-lime bg-lime-dim shadow-[0_0_24px_-8px_#B8FF3D80]" : "border-line bg-surface hover:border-mute"}`}>
          <span className={`text-xl font-semibold tabular-nums ${g === selected ? "text-lime" : ""}`}>{pad2(g)}</span><span className="text-[11px] text-mute">Class</span>
        </Link>
      ))}
    </nav>
  );
}
