"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sidebarNav } from "@/lib/nav";
import { Logo } from "@/components/ui/Logo";
export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-bg p-4 lg:flex">
      <div className="px-2 py-3"><Logo /></div>
      <nav aria-label="Sidebar" className="mt-6 flex flex-1 flex-col gap-0.5">
        {sidebarNav.map(({ href, label, icon: Icon }) => {
          const on = path === href || path.startsWith(href + "/");
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined}
              className={`flex min-h-[40px] items-center gap-3 rounded-ctl px-3 text-sm transition ${on ? "bg-raised text-lime" : "text-sub hover:bg-surface hover:text-ink"}`}>
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />{label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
