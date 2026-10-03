import Link from "next/link";
import { ListTodo, Plus } from "lucide-react";
import { listTasks } from "@/services/workspace";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { TaskToggle, DeleteButton } from "@/components/workspace/RowActions";
import { PRIORITY_LABEL } from "@/lib/format";
import { diffDaysISO, formatDate } from "@/lib/time";
import type { TaskRow } from "@/services/workspace";
export const dynamic = "force-dynamic";
function Row({ t, today }: { t: TaskRow; today: string }) {
  const d = t.due_date ? diffDaysISO(t.due_date, today) : null, overdue = d !== null && d < 0 && t.status !== "completed";
  return (
    <li className="card flex items-start gap-2 p-3">
      <TaskToggle id={t.id} done={t.status === "completed"} title={t.title} />
      <div className="min-w-0 flex-1 py-1">
        <p className={`break-words ${t.status === "completed" ? "text-sub line-through" : ""}`}>{t.title}</p>
        {t.description && <p className="mt-0.5 line-clamp-2 text-sm text-sub">{t.description}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          {t.due_date && <span className={overdue ? "text-violet-fg" : "text-mute"}>{d === 0 ? "Due today" : overdue ? `Overdue · ${formatDate(t.due_date)}` : `Due ${formatDate(t.due_date)}`}</span>}
          {t.priority !== "medium" && <Badge tone={t.priority === "very_high" || t.priority === "high" ? "lime" : "mute"}>{PRIORITY_LABEL[t.priority]}</Badge>}
          {t.link && <Link href={t.link.href} className="inline-flex min-h-[32px] items-center text-sub underline hover:text-lime">{t.link.title}</Link>}
        </div>
      </div>
      <DeleteButton kind="task" id={t.id} title={t.title} />
    </li>);
}
export default async function Tasks() {
  const { today, open, done } = await listTasks();
  return (
    <div>
      <PageHeader title="Tasks" subtitle="Your own to-dos. Tasks due today appear in your daily focus." actions={<Link href="/tasks/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden />New task</Link>} />
      {open.length === 0 && done.length === 0 ? <EmptyState icon={ListTodo} title="No tasks yet" hint="Add a task, or use “Add to today’s focus” in Study Mode." action={{ href: "/tasks/new", label: "Add a task" }} /> : (
        <div className="space-y-8">
          <section aria-labelledby="open-h"><h2 id="open-h" className="mb-3 font-semibold">Open <span className="text-sm font-normal text-mute">({open.length})</span></h2>
            {open.length ? <ul className="space-y-2">{open.map((t) => <Row key={t.id} t={t} today={today} />)}</ul> : <p className="text-sm text-sub">Everything is done.</p>}</section>
          {done.length > 0 && <section aria-labelledby="done-h"><h2 id="done-h" className="mb-3 font-semibold">Recently completed</h2><ul className="space-y-2">{done.map((t) => <Row key={t.id} t={t} today={today} />)}</ul></section>}
        </div>)}
    </div>);
}
