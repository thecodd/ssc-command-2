import { PRIORITY_LABEL, RELEVANCE_LABEL, STATUS_LABEL } from "./format";
import type { SyllabusFilters } from "@/types/curriculum";
export const isUuid = (v?: string | null): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const oneOf = (v: string | undefined, map: Record<string, string>) => (v && Object.prototype.hasOwnProperty.call(map, v) ? v : undefined);
/** Whitelists every URL-derived value so a hand-edited URL can't reach Postgres as an invalid enum/uuid. */
export function parseSyllabusFilters(sp: Record<string, string | undefined>): SyllabusFilters {
  const cls = Number(sp.cls);
  return {
    q: sp.q?.trim().slice(0, 80) || undefined,
    source: sp.source === "ncert" || sp.source === "ssc" ? sp.source : undefined,
    cls: Number.isInteger(cls) && cls >= 6 && cls <= 12 ? cls : undefined,
    subject: sp.subject?.slice(0, 120) || undefined,
    topic: isUuid(sp.topic) ? sp.topic : undefined,
    relevance: oneOf(sp.relevance, RELEVANCE_LABEL),
    priority: oneOf(sp.priority, PRIORITY_LABEL),
    status: oneOf(sp.status, STATUS_LABEL),
  };
}
