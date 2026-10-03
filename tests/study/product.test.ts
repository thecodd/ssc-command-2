import * as fs from "fs";
import * as path from "path";
// Product-surface regressions: every navigation target is a real screen, no placeholder catch-all, workspace writes are validated and owner-scoped.
const root = path.join(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const exists = (f: string) => fs.existsSync(path.join(root, f));
const pageFor = (href: string) => { const seg = href.split("?")[0].replace(/^\//, ""); return ["app/(app)", "app/(focus)", "app"].some((g) => exists(`${g}/${seg}/page.tsx`)); };
export default async function () {
  await t("product: every sidebar, mobile and quick-add link has a real page (nothing falls through to a placeholder)", () => {
    const nav = read("lib/nav.ts"); const hrefs = Array.from(nav.matchAll(/href: "([^"]+)"/g)).map((m) => m[1]);
    assert.ok(hrefs.length >= 15); for (const h of hrefs) assert.ok(pageFor(h), `no page for ${h}`);
  });
  await t("product: the catch-all is a real 404, never 'isn't built yet'", () => {
    const c = read("app/(app)/[...slug]/page.tsx"); assert.match(c, /notFound\(\)/); assert.doesNotMatch(c, /built yet|upcoming/i); assert.ok(exists("app/not-found.tsx"));
    for (const d of ["app", "components"]) (function walk(p: string) { for (const f of fs.readdirSync(path.join(root, p))) { const q = `${p}/${f}`; if (fs.statSync(path.join(root, q)).isDirectory()) walk(q); else if (/\.tsx?$/.test(f)) assert.doesNotMatch(read(q), /coming soon|isn't built yet|lorem ipsum/i, q); } })(d);
  });
  await t("product: search results always land on a real route (/notes, /resources, /tasks, /pyqs exist)", () => { for (const h of ["/notes", "/resources", "/tasks", "/pyqs", "/search", "/analytics", "/settings"]) assert.ok(pageFor(h), h); });
  await t("product: sign-out exists and is reachable from Settings and More", () => {
    assert.match(read("app/actions/workspace.ts"), /export async function signOutAction\(\)[\s\S]*auth\.signOut\(\)[\s\S]*redirect\("\/login"\)/);
    assert.match(read("app/(app)/settings/page.tsx"), /signOutAction/); assert.match(read("app/(app)/more/page.tsx"), /signOutAction/);
  });
  await t("product: workspace writes validate input and are scoped to the owner", () => {
    const a = read("app/actions/workspace.ts"), s = read("services/workspace.ts");
    assert.match(a, /isUuid\(id\)/); assert.match(a, /PRIORITIES\.includes/); assert.match(a, /RTYPES\.includes/); assert.match(a, /Revision ladder: 2-10 increasing/); assert.match(a, /isValidTimeZone\(tz\)/);
    for (const m of ["setTaskDone", "deleteTask", "deleteNote", "deleteResource"]) assert.match(s, new RegExp(`export async function ${m}[\\s\\S]{0,260}\\.eq\\("user_id", user\\.id\\)`), m);
    assert.doesNotMatch(a, /is_admin/); assert.match(s, /http:\/\/ or https:\/\//);
  });
  await t("product: analytics and the PYQ bank only use real rows (no hard-coded statistics)", () => {
    const a = read("services/analytics.ts") + read("app/(app)/analytics/page.tsx") + read("services/pyqBank.ts") + read("app/(app)/pyqs/page.tsx");
    assert.match(a, /count: "exact", head: true/); assert.match(a, /subject_pyq_counts/); assert.doesNotMatch(a, /Math\.random|faker|FIXTURES|@\/tests\//);
  });
  await t("product: the real-browser gate covers the new screens", () => {
    const e = read("tests/e2e/real_routes.mjs"); for (const r of ["/pyqs", "/tasks", "/notes", "/resources", "/analytics", "/settings", "/search?q="]) assert.ok(e.includes(`"${r}`), r);
  });
}
