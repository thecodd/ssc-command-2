"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { mobileNav } from "@/lib/nav";
export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {mobileNav.map(({ href, label, icon: Icon }) => {
          const on = path === href || path.startsWith(href + "/");
          return (
            <li key={href}>
              <Link href={href} aria-current={on ? "page" : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-1 text-[11px] ${on ? "text-lime" : "text-mute"}`}>
                <Icon className="h-5 w-5" strokeWidth={1.75} />{label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
