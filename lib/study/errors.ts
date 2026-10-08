// Errors that cross the server/client boundary carry a CODE, never the raw database message.
export type ErrorCode = "auth" | "not_found" | "ended" | "conflict" | "invalid" | "network" | "timeout" | "unknown";
export class AppError extends Error { constructor(public code: ErrorCode, message = code) { super(message); this.name = "AppError"; } }

const TEXT: Record<ErrorCode, string> = {
  auth: "Your session expired. Sign in again to continue.",
  not_found: "We couldn't find that item. It may have been archived.",
  ended: "That study session has already ended.",
  conflict: "This changed in another tab or device. We've refreshed it.",
  invalid: "That value isn't allowed. Check it and try again.",
  network: "Can't reach the server. Check your connection and retry.",
  timeout: "That took too long. Retry.",
  unknown: "Something went wrong. Try again.",
};
export const userMessage = (code: ErrorCode): string => TEXT[code];

/** Maps a PostgREST/Postgres error ({code, message}) or a thrown Error to a stable code. Messages are only used as a fallback. */
export function classifyError(e: unknown): ErrorCode {
  if (e instanceof AppError) return e.code;
  const x = (e ?? {}) as { code?: string; message?: string; name?: string };
  switch (x.code) {
    case "P0002": return "not_found";
    case "55000": return "ended";
    case "PT409": case "40001": return "conflict";
    case "22023": case "23514": case "23505": case "22P02": return "invalid";
    case "42501": case "PGRST301": case "PGRST302": return "auth";
  }
  const m = (x.message ?? "").toLowerCase();
  if (m.includes("signed out") || m.includes("jwt") || m.includes("not authenticated")) return "auth";
  if (m.includes("fetch failed") || m.includes("network") || m.includes("econn") || m.includes("failed to fetch")) return "network";
  if (m.includes("timed out") || m.includes("timeout") || x.name === "TimeoutError") return "timeout";
  if (m.includes("not found")) return "not_found";
  if (m.includes("already ended") || m.includes("already complete")) return "ended";
  return "unknown";
}
export const toAppError = (e: unknown) => new AppError(classifyError(e));
