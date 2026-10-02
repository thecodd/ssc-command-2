"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/client";
import { LogoMark } from "@/components/ui/Logo";
export default function Login() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in"); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (!hasSupabaseEnv()) return setMsg("Supabase isn't configured. Add your keys to .env.local and restart.");
    setBusy(true);
    const sb = createClient();
    const { error } = mode === "in" ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setMsg(error.message);
    if (mode === "up") return setMsg("Check your email to confirm, then sign in.");
    router.replace("/dashboard"); router.refresh();
  }
  const input = "min-h-[48px] w-full rounded-ctl border border-line bg-surface px-4 text-sm outline-none focus:border-lime";
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <LogoMark size={40} />
        <h1 className="text-3xl font-bold tracking-tight">{mode === "in" ? "Welcome back" : "Create your account"}</h1>
        <label className="block"><span className="sr-only">Email</span><input className={input} type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
        <label className="block"><span className="sr-only">Password</span><input className={input} type="password" required minLength={6} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "in" ? "current-password" : "new-password"} /></label>
        {msg && <p role="alert" className="text-sm text-sub">{msg}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Please wait..." : mode === "in" ? "Sign in" : "Sign up"}</button>
        <button type="button" className="w-full text-sm text-sub" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}</button>
      </form>
    </div>
  );
}
