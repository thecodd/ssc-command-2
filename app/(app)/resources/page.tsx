import Link from "next/link";
import { ExternalLink, FolderOpen, Plus, ShieldCheck } from "lucide-react";
import { listResources, type ResourceRow } from "@/services/workspace";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { DeleteButton } from "@/components/workspace/RowActions";
import { safeExternalUrl } from "@/lib/url";
export const dynamic = "force-dynamic";
function Row({ r }: { r: ResourceRow }) {
  const href = safeExternalUrl(r.url);
  return (
    <li className="card flex items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium">{href ? <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-[44px] items-center gap-1.5 hover:text-lime">{r.title}<ExternalLink className="h-3.5 w-3.5 shrink-0 text-mute" aria-hidden /><span className="sr-only">(opens in a new tab)</span></a> : r.title}</p>
        {r.description && <p className="mt-0.5 line-clamp-2 text-sm text-sub">{r.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs"><Badge>{r.type}</Badge>{r.official && <Badge tone="lime"><ShieldCheck className="mr-1 h-3 w-3" aria-hidden />Official</Badge>}{r.link && <Link href={r.link.href} className="inline-flex min-h-[32px] items-center text-sub underline hover:text-lime">{r.link.title}</Link>}</div>
      </div>
      {!r.official && <DeleteButton kind="resource" id={r.id} title={r.title} />}
    </li>);
}
export default async function Resources() {
  const { mine, official } = await listResources();
  return (
    <div>
      <PageHeader title="Resources" subtitle="Official sources first, then the links you saved." actions={<Link href="/resources/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden />Add</Link>} />
      {!mine.length && !official.length ? <EmptyState icon={FolderOpen} title="No resources yet" hint="Save a link you trust (a PDF, a video, a website) and attach it to a chapter or topic." action={{ href: "/resources/new", label: "Add a resource" }} /> : (
        <div className="space-y-8">
          {official.length > 0 && <section aria-labelledby="off-h"><h2 id="off-h" className="mb-3 font-semibold">Official</h2><ul className="space-y-2">{official.map((r) => <Row key={r.id} r={r} />)}</ul></section>}
          <section aria-labelledby="mine-h"><h2 id="mine-h" className="mb-3 font-semibold">Saved by you <span className="text-sm font-normal text-mute">({mine.length})</span></h2>
            {mine.length ? <ul className="space-y-2">{mine.map((r) => <Row key={r.id} r={r} />)}</ul> : <p className="text-sm text-sub">Nothing saved yet.</p>}</section>
        </div>)}
    </div>);
}
