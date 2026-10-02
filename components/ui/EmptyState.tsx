import Link from "next/link";
import type { LucideIcon } from "lucide-react";
type A = { href: string; label: string; primary?: boolean };
export function EmptyState({ icon: Icon, title, hint, action, actions }: { icon: LucideIcon; title: string; hint?: string; action?: A; actions?: A[] }) {
  const list = actions ?? (action ? [action] : []);
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Icon className="h-6 w-6 text-mute" strokeWidth={1.5} />
      <p className="text-lg font-medium">{title}</p>
      {hint && <p className="max-w-xs text-sm text-sub">{hint}</p>}
      {list.length > 0 && <div className="mt-3 flex flex-wrap justify-center gap-2">{list.map((a, i) => <Link key={a.href} href={a.href} className={a.primary ?? i === 0 ? "btn-primary" : "btn-ghost"}>{a.label}</Link>)}</div>}
    </div>
  );
}
