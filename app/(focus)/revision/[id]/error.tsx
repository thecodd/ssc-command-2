"use client";
import Link from "next/link";
// Never prints error.message (it can be a database message).
export default function ReviewError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">This revision couldn&apos;t load</h1><p className="mt-2 text-sm text-sub">Something went wrong on our side. Nothing was changed.</p>
      {error.digest && <p className="mt-2 text-xs text-mute">Reference: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-2"><button type="button" className="btn-primary" onClick={reset}>Try again</button><Link href="/revision" className="btn-ghost">Back to queue</Link></div>
    </div>);
}
