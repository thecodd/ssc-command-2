import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { sidebarNav } from "@/lib/nav";
import { PageHeader } from "@/components/ui/PageHeader";
import { LogOut } from "lucide-react";
import { signOutAction } from "@/app/actions/workspace";
const HIDE = ["/dashboard", "/syllabus", "/study", "/revision"];
export default function More() {
  return (
    <div><PageHeader title="More" />
      <ul className="card divide-y divide-line overflow-hidden">
        {sidebarNav.filter((n) => !HIDE.includes(n.href)).map(({ href, label, icon: Icon }) => (
          <li key={href}><Link href={href} className="flex min-h-[56px] items-center gap-3 px-4 hover:bg-raised"><Icon className="h-5 w-5 text-sub" strokeWidth={1.75} /><span className="flex-1">{label}</span><ChevronRight className="h-4 w-4 text-mute" /></Link></li>
        ))}
      </ul>
      <form action={signOutAction} className="mt-4"><button type="submit" className="btn-ghost w-full"><LogOut className="h-4 w-4" aria-hidden />Sign out</button></form>
    </div>
  );
}
