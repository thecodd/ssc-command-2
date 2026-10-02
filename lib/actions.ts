import { classifyError, userMessage } from "@/lib/study/errors";
export type ActionState = { ok?: boolean; error?: string; message?: string } | null;
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export async function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try { return { ok: true, data: await fn() }; }
  catch (e: unknown) {
    // Database/PostgREST errors carry a string `code`: show OUR copy for them, never the raw message. Plain Errors we threw ourselves keep their text.
    if (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string") return { ok: false, error: userMessage(classifyError(e)) };
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, error: msg || "Something went wrong." };
  }
}
export const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
