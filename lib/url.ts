// External links come from user or admin input. Only absolute http(s) URLs become clickable: a stored "javascript:" or "data:" URL
// (written straight through the API, bypassing the form) must never reach an <a href>.
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try { const u = new URL(url.trim()); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch { return null; }
}
