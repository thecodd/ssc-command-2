import Link from "next/link";
import { diffDaysISO, formatDate as fmtDate } from "@/lib/time";
import { CheckCircle2, Flame, RefreshCw, ListTodo, Layers } from "lucide-react";
import { getDashboard } from "@/services/dashboard";
import { listDueTasks } from "@/services/workspace";
import { dbConfigured, getUser } from "@/lib/auth";
import { TaskToggle } from "@/components/workspace/RowActions";
import { Ring, Bar } from "@/components/ui/Ring";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchTrigger } from "@/components/dashboard/SearchTrigger";
import { FOCUS_LABEL, type FocusKind } from "@/lib/learning/rules";


export default async function Dashboard() {
  const [d, due] = await Promise.all([getDashboard(), dueTasks()]);
  const goalPct = Math.min(100, Math.round((d.todayMinutes / d.dailyGoalMinutes) * 100));
  const rows: [string, number][] = [["NCERT", d.progress.ncert], ["SSC", d.progress.ssc], ["PYQs", d.progress.pyq], ["Revision", d.progress.revision]];
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">{d.greeting}, {d.name}</h1>
        <p className="mt-1 text-sm text-sub">Ready to build today&apos;s streak?</p>
      </header>
      <SearchTrigger />

      <section aria-labelledby="focus" className="card p-5 lg:p-6">
        <h2 id="focus" className="text-sm text-sub">Today&apos;s Focus</h2>
        {d.focus ? (
          <div className="mt-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-2xl font-semibold">{d.focus.title}</p>
              <p className="text-sm text-sub">{d.focusKind && d.focusKind in FOCUS_LABEL ? `${FOCUS_LABEL[d.focusKind as FocusKind]} · ` : ""}{d.focus.subject}</p>
              <div className="mt-4 flex flex-wrap gap-2"><Link href={d.focus.href} className="btn-primary">Open Study Mode</Link><Link href="/study" className="btn-ghost">All focus items</Link></div>
            </div>
            <Ring value={d.focus.percent} label="Topic progress" />
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-xl font-semibold">Pick your first topic</p>
            <p className="mt-1 text-sm text-sub">Nothing in progress yet. Choose something from the syllabus to start.</p>
            <Link href="/syllabus" className="btn-primary mt-4"><Layers className="h-4 w-4" />Open Master Syllabus</Link>
          </div>
        )}
      </section>

      <section className="grid grid-cols-3 gap-3" aria-label="Today">
        <Stat icon={<Flame className="h-4 w-4 text-lime" />} value={String(d.streak)} label="Day streak" />
        <Stat icon={<CheckCircle2 className="h-4 w-4 text-lime" />} value={`${d.todayMinutes}/${d.dailyGoalMinutes}m`} label={`Goal ${goalPct}%`} />
        <Stat icon={<ListTodo className="h-4 w-4 text-lime" />} value={String(d.pendingTasks)} label="Open tasks" />
      </section>

      {due && (
        <section aria-labelledby="due-tasks" className="card p-5">
          <div className="mb-2 flex items-center justify-between gap-3"><h2 id="due-tasks" className="font-semibold">Tasks due today</h2><Link href="/tasks" className="inline-flex min-h-[44px] items-center text-sm text-lime">All tasks</Link></div>
          {due.tasks.length === 0 ? <p className="text-sm text-sub">Nothing due today. <Link href="/tasks/new" className="text-lime underline">Add a task</Link></p> : (
            <ul className="divide-y divide-line">
              {due.tasks.map((t) => { const late = t.due_date ? diffDaysISO(t.due_date, due.today) < 0 : false; return (
                <li key={t.id} className="flex items-center gap-2 py-1">
                  <TaskToggle id={t.id} done={false} title={t.title} />
                  <div className="min-w-0 flex-1"><p className="break-words">{t.title}</p>
                    <p className="text-xs">{late && t.due_date ? <span className="text-violet-fg">Overdue · {fmtDate(t.due_date)}</span> : <span className="text-mute">Due today</span>}{t.link && <> · <Link href={t.link.href} className="text-sub underline hover:text-lime">{t.link.title}</Link></>}</p></div>
                </li>); })}
            </ul>)}
          {due.more > 0 && <p className="mt-2 text-sm text-sub">+{due.more} more in <Link href="/tasks" className="text-lime underline">Tasks</Link></p>}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5" aria-labelledby="momentum">
          <div className="flex items-center gap-5">
            <Ring value={d.progress.overall} label="Overall" />
            <div><h2 id="momentum" className="font-semibold">Your Momentum</h2><p className="text-sm text-sub">Overall completion</p></div>
          </div>
          <ul className="mt-5 space-y-3">
            {rows.map(([k, v]) => (
              <li key={k}><div className="mb-1.5 flex justify-between text-sm"><span className="text-sub">{k}</span><span className="tabular-nums">{v}%</span></div><Bar value={v} /></li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="attention">
          <h2 id="attention" className="mb-3 font-semibold">Needs Your Attention</h2>
          {d.weakCount > 0 && <Link href="/study" className="card mb-3 flex items-center justify-between p-5 transition hover:border-mute"><span>{d.weakCount} weak {d.weakCount === 1 ? "spot" : "spots"} to fix</span><span className="text-sm text-lime">Study</span></Link>}
          {d.revision === null ? null : d.revision.overdue + d.revision.today + d.revision.upcoming === 0 ? (
            <div className="card p-5"><p className="flex items-center gap-2 font-medium"><RefreshCw className="h-4 w-4 text-lime" aria-hidden />You&apos;re caught up.</p><p className="mt-1 text-sm text-sub">Complete a topic and its first revision is scheduled for you.</p><div className="mt-3 flex flex-wrap gap-2"><Link href="/study" className="btn-primary">Study a topic</Link><Link href="/practice/new?scope=mixed" className="btn-ghost">Practice PYQs</Link></div></div>
          ) : (
            <div className="card p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm text-sub"><RefreshCw className="h-4 w-4" aria-hidden />Revision queue</h3>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <div><dd className="text-2xl font-semibold tabular-nums">{d.revision.overdue}</dd><dt className="text-xs text-mute">Overdue</dt></div>
                <div><dd className="text-2xl font-semibold tabular-nums">{d.revision.today}</dd><dt className="text-xs text-mute">Due today</dt></div>
                <div><dd className="text-2xl font-semibold tabular-nums">{d.revision.upcoming}</dd><dt className="text-xs text-mute">Upcoming</dt></div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {d.revision.startId ? <Link href={`/revision/${d.revision.startId}`} className="btn-primary">Start revision</Link> : <p className="self-center text-sm text-sub">Nothing is due{d.revision.nextDue ? `. Next: ${fmtDate(d.revision.nextDue)}` : ""}.</p>}
                <Link href="/revision" className="btn-ghost">Open queue</Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
/** Open tasks due today or overdue; null when there is no signed-in user (the dashboard then shows its own empty state). */
async function dueTasks() {
  if (!dbConfigured()) return null;
  const { user } = await getUser(); if (!user) return null;
  return listDueTasks(5);
}
function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return <div className="card p-4"><div className="mb-2">{icon}</div><p className="text-xl font-semibold tabular-nums">{value}</p><p className="text-xs text-sub">{label}</p></div>;
}
