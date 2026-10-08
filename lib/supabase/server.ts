import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { CookieToSet } from "./cookies";
// Next 15: cookies() is asynchronous. Calling it HERE (not lazily inside the callbacks) is what opts every caller into dynamic rendering,
// so a page that reads the user's data can never be prerendered at build time. The Supabase client accepts async cookie callbacks,
// so createClient() itself stays synchronous for every caller.
export function createClient() {
  const jar = cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: async () => (await jar).getAll(),
      setAll: async (list: CookieToSet[]) => { try { const store = await jar; list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {} },
    },
  });
}
