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
}
