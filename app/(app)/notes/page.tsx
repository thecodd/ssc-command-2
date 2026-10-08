import Link from "next/link";
import { Plus, Search, StickyNote } from "lucide-react";
import { listNotes } from "@/services/workspace";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { fieldCls } from "@/components/ui/field";
export const dynamic = "force-dynamic";
export default async function Notes({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").slice(0, 80), notes = await listNotes(q);
  return (
    <div>
      <PageHeader title="Notes" subtitle="Private to you, attached to the chapter or topic they explain." actions={<Link href="/notes/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden />New note</Link>} />
      <form role="search" className="mb-5"><label className="relative block"><span className="sr-only">Search notes</span><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" aria-hidden />
        <input name="q" defaultValue={q} placeholder="Search your notes" className={`${fieldCls} pl-10`} /></label></form>
      {notes.length === 0 ? (q ? <EmptyState icon={Search} title="No notes match" hint="Try another word." action={{ href: "/notes", label: "Show all notes" }} />
        : <EmptyState icon={StickyNote} title="No notes yet" hint="Write notes while you study a chapter or topic, or start one here." action={{ href: "/notes/new", label: "Write a note" }} />) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))]">
          {notes.map((n) => (
            <li key={n.id} className="card relative min-w-0 p-4 hover:border-mute">
              <h2 className="font-medium"><Link href={`/notes/${n.id}`} className="after:absolute after:inset-0 after:rounded-card">{n.title || "Untitled note"}</Link></h2>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-sub">{n.content}</p>
              <p className="mt-2 truncate text-xs text-mute">{n.link ? n.link.title : "Unlinked item"} · {new Date(n.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</p>
            </li>))}
        </ul>)}
    </div>);
}
