"use client";
import Link from "next/link";
// Never prints error.message (could be a database message).
export default function PracticeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">Practice couldn&apos;t load</h1>
      <p className="mt-2 text-sm text-sub">Your answers so far are saved. Try again.</p>
      {error.digest && <p className="mt-2 text-xs text-mute">Reference: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-2"><button type="button" className="btn-primary" onClick={reset}>Try again</button><Link href="/study" className="btn-ghost">Back to Study</Link></div>
    </div>
  );
}
