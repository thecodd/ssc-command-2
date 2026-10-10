import * as fs from "fs";
import * as path from "path";
declare const t: (name: string, fn: () => void | Promise<void>) => Promise<void>;
declare const assert: typeof import("assert");
declare const require: any;
const root = path.join(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
export default async function () {
  const { mockSeconds, remainingSeconds, ensureDeadline, parseTimed, clock } = require(path.join(root, "lib/practice/mock.ts"));
  await t("mock: exam pace is 36 s per question and the clock formats mm:ss", () => {
    assert.equal(mockSeconds(10), 360); assert.equal(mockSeconds(100), 3600); assert.equal(clock(3600), "60:00"); assert.equal(clock(65), "01:05");
  });
  await t("mock: remaining time never goes negative and only timed=1 turns the mode on", () => {
    assert.equal(remainingSeconds(10_000, 4_000), 6); assert.equal(remainingSeconds(10_000, 20_000), 0);
    assert.equal(parseTimed("1"), true); assert.equal(parseTimed("true"), false); assert.equal(parseTimed(undefined), false);
  });
  await t("mock: a refresh keeps the ORIGINAL deadline; broken storage still yields one", () => {
    const m = new Map<string, string>(); const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const d1 = ensureDeadline("s1", 360, 1_000, store), d2 = ensureDeadline("s1", 360, 99_000, store);
    assert.equal(d1, 361_000); assert.equal(d2, d1);
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    assert.equal(ensureDeadline("s2", 10, 5_000, broken), 15_000);
  });
  await t("pwa: manifest is installable (id, scope, standalone, any + maskable icons that exist) and the offline page is shipped", () => {
    const m = JSON.parse(read("public/manifest.json"));
    assert.equal(m.display, "standalone"); assert.equal(m.scope, "/"); assert.ok(m.id && m.start_url);
    const purposes = new Set(m.icons.map((i: any) => i.purpose)); assert.ok(purposes.has("any") && purposes.has("maskable"));
    assert.ok(m.icons.some((i: any) => i.sizes === "192x192") && m.icons.some((i: any) => i.sizes === "512x512"));
    for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, "public", i.src)), i.src);
    assert.ok(fs.existsSync(path.join(root, "public/offline.html")) && fs.existsSync(path.join(root, "public/icons/apple-touch-icon.png")));
  });
  await t("pwa: the service worker never caches pages or data (only /_next/static) and falls back to the offline page on navigation", () => {
    const sw = read("public/sw.js");
    assert.match(sw, /mode === "navigate"[\s\S]*offline\.html/); assert.match(sw, /_next\/static\//);
    assert.doesNotMatch(sw, /supabase|\/api\//);
  });
  const D = require(path.join(root, "lib/practice/mockDraft.ts"));
  const ids = ["a", "b", "c", "d"];
  await t("mock draft: answers can be changed and cleared, flags toggle, and status/counts follow", () => {
    let d = D.emptyDraft(); d = D.setAnswer(d, "a", "A"); d = D.setAnswer(d, "a", "C"); d = D.setAnswer(d, "b", "B"); d = D.toggleFlag(d, "b"); d = D.setAnswer(d, "c", "D"); d = D.setAnswer(d, "c", null);
    assert.equal(d.sel.a, "C"); assert.equal(D.statusOf(d, "a"), "answered"); assert.equal(D.statusOf(d, "b"), "flagged"); assert.equal(D.statusOf(d, "c"), "unanswered");
    assert.deepEqual(D.counts(d, ids), { answered: 2, unanswered: 2, flagged: 1 }); assert.deepEqual(D.toggleFlag(d, "b").flagged, []);
  });
  await t("mock draft: submission order follows the paper and skips anything the server already holds", () => {
    const d = { sel: { d: "A", a: "B", c: "C" }, flagged: [] };
    assert.deepEqual(D.pendingSubmissions(ids, d, ["c"]), [{ id: "a", selected: "B" }, { id: "d", selected: "A" }]);
  });
  await t("mock draft: a tampered or stale stored draft can only ever contain this session's questions", () => {
    const d = D.sanitizeDraft({ sel: { a: "B", zzz: "A", b: 7, c: "x".repeat(50) }, flagged: ["a", "zzz", 3, "a"] }, ids);
    assert.deepEqual(d, { sel: { a: "B" }, flagged: ["a"] }); assert.deepEqual(D.sanitizeDraft("junk", ids), D.emptyDraft());
  });
  await t("mock draft: persists per session, survives broken storage and clears after submit", () => {
    const m = new Map<string, string>(); const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    D.saveDraft("s1", { sel: { a: "B" }, flagged: [] }, store); assert.equal(D.loadDraft("s1", ids, store).sel.a, "B"); assert.deepEqual(D.loadDraft("other", ids, store), D.emptyDraft());
    D.clearDraft("s1", store); assert.deepEqual(D.loadDraft("s1", ids, store), D.emptyDraft());
    const broken = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
    D.saveDraft("s1", D.emptyDraft(), broken); D.clearDraft("s1", broken); assert.deepEqual(D.loadDraft("s1", ids, broken), D.emptyDraft());
  });
  await t("mock runner: grading stays server-side (submit/finish/question only), no answer key is read before submit", () => {
    const src = read("components/practice/MockRunner.tsx");
    assert.match(src, /api\.submit\(/); assert.match(src, /api\.finish\(/);
    assert.doesNotMatch(src, /correct_answer\s*[!=]==\s*(?:draft|selected)|from "@\/tests\//);   // no client-side grading, no fixtures
  });
}
