import Link from "next/link";
import { FocusButton } from "./FocusButton";
import type { EntityType } from "@/types/curriculum";
export function ContextActions({ links, focus }: { links: { href: string; label: string; icon: React.ReactNode }[]; focus: { type: EntityType; id: string; title: string } }) {
  return (
    <div className="no-scrollbar -mx-4 flex flex-wrap gap-2 px-4 lg:mx-0 lg:px-0">
      {links.map((l) => <Link key={l.href + l.label} href={l.href} scroll={false} className="btn-ghost">{l.icon}{l.label}</Link>)}
      <FocusButton {...focus} />
    </div>
  );
}
