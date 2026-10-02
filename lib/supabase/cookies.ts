import type { CookieOptions } from "@supabase/ssr";
/** Shape of one cookie handed to the `setAll` callback of createServerClient (@supabase/ssr 0.5). Typed explicitly because the library's overloads defeat contextual typing. */
export type CookieToSet = { name: string; value: string; options: CookieOptions };
