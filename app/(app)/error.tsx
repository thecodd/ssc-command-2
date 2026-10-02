"use client";
import { AlertTriangle } from "lucide-react";
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center" role="alert">
      <AlertTriangle className="h-6 w-6 text-mute" strokeWidth={1.5} />
      <p className="text-lg font-medium">This page didn&apos;t load</p>
      <p className="max-w-sm text-sm text-sub">{error.message?.includes("Supabase isn't configured") ? error.message : "The database request failed. Check your connection and that the migrations have been run."}</p>
      <button onClick={reset} className="btn-primary mt-3">Retry</button>
    </div>
  );
}
