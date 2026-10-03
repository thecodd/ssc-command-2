import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="text-sm text-mute">404</p><h1 className="mt-1 text-2xl font-semibold">This page doesn&apos;t exist</h1>
      <p className="mt-2 text-sm text-sub">The link may be old, or the item was archived.</p>
      <div className="mt-6 flex gap-2"><Link href="/dashboard" className="btn-primary">Dashboard</Link><Link href="/search" className="btn-ghost">Search</Link></div>
    </main>);
}
