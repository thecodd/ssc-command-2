import { createClient } from "@/lib/supabase/server";
import { cache } from "@/lib/cache";
export type Db = ReturnType<typeof createClient>;
export const dbConfigured = () => !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export function getDb(): Db {
  if (!dbConfigured()) throw new Error("Supabase isn't configured. Add your keys to .env.local and restart.");
  return createClient();
}
export const getUser = cache(async () => { const sb = getDb(); const { data: { user } } = await sb.auth.getUser(); return { sb, user }; });
export async function requireUser() {
  const { sb, user } = await getUser();
  if (!user) throw new Error("You're signed out. Sign in again.");
  return { sb, user };
}
export async function checkAdmin(sb: Db, uid: string) {
  const { data } = await sb.from("profiles").select("is_admin").eq("id", uid).maybeSingle();
  return !!data?.is_admin;
}
export async function requireAdmin() {
  const r = await requireUser();
  if (!(await checkAdmin(r.sb, r.user.id))) throw new Error("Admin access required.");
  return r;
}
export async function currentIsAdmin() {
  try { const { sb, user } = await getUser(); return !!user && (await checkAdmin(sb, user.id)); } catch { return false; }
}
