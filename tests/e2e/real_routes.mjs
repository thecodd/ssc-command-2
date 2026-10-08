#!/usr/bin/env node
// REAL-APP browser validation (not fixtures). Needs: a running Next.js app (production build), a Supabase backend with migrations 001-014 applied, a scratch user with
// seeded study data, and Playwright (+ optional axe-core). Invoked by scripts/validate_phase7.mjs, or directly:
//   E2E_EMAIL=... E2E_PASSWORD=... node tests/e2e/real_routes.mjs --base-url http://127.0.0.1:3100 --out reports/e2e.json
// Exit: 0 all pass | 1 any FAIL | 3 only BLOCKED (e.g. missing Playwright / no seeded data). It NEVER reports PASS for something it could not exercise.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import { createRequire } from "node:module";
import { trackFailures } from "./network_filter.mjs";
import { pickRadio, waitForAlertText } from "./interactions.mjs";
const require = createRequire(import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = (arg("--base-url", process.env.E2E_BASE_URL || "http://127.0.0.1:3000")).replace(/\/$/, ""), OUT = arg("--out", "e2e.json");
const EMAIL = process.env.E2E_EMAIL, PASSWORD = process.env.E2E_PASSWORD;
const VIEWPORTS = [360, 390, 412, 1024, 1440];
const ROUTES = ["/dashboard", "/study", "/revision", "/practice/new?scope=mixed", "/syllabus", "/ncert", "/ssc", "/mapping", "/search?q=fixture", "/pyqs", "/tasks", "/tasks/new", "/notes", "/notes/new", "/resources", "/resources/new", "/analytics", "/settings", "/more"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ART = process.env.E2E_ARTIFACTS_DIR || "";
if (ART) fs.mkdirSync(ART, { recursive: true });
const slug = (s) => String(s).replace(/[^\w.-]+/g, "_").slice(0, 90);
const clog = (name, line) => { if (ART) fs.appendFileSync(path.join(ART, "browser-console.log"), `[${new Date().toISOString()}] ${name} ${line}\n`); };
const res = { base: BASE, routes: [], a11y: [] };
const add = (list, name, status, detail = "") => { list.push({ name, status, detail: String(detail).slice(0, 600) }); console.log(`[${status.padEnd(7)}] ${name}${detail ? " :: " + String(detail).slice(0, 160) : ""}`); };
const R = (n, s, d) => add(res.routes, n, s, d), A = (n, s, d) => add(res.a11y, n, s, d);
const finish = () => { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); const all = [...res.routes, ...res.a11y]; process.exit(all.some((i) => i.status === "FAIL") ? 1 : all.some((i) => i.status === "BLOCKED") ? 3 : 0); };
function load(name) { try { return require(name); } catch {} try { return require(path.join(cp.execSync("npm root -g").toString().trim(), name)); } catch {} return null; }
const pw = load("playwright") || load("@playwright/test");
if (!pw) { R("playwright", "BLOCKED", "Playwright is not installed (npm i -D playwright && npx playwright install chromium)"); A("playwright", "BLOCKED", "Playwright is not installed"); finish(); }
if (!EMAIL || !PASSWORD) { R("credentials", "BLOCKED", "E2E_EMAIL / E2E_PASSWORD not set"); finish(); }
let axeSource = null; try { axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"); } catch { const g = load("axe-core"); if (g) try { axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js", { paths: [cp.execSync("npm root -g").toString().trim()] }), "utf8"); } catch {} }

const browser = await pw.chromium.launch({ args: ["--no-sandbox"] }).catch((e) => { R("chromium", "BLOCKED", "cannot launch Chromium: " + e.message.split("\n")[0]); finish(); });
// ---- login once, reuse the session everywhere
const lctx = await browser.newContext({ viewport: { width: 1024, height: 800 } }), lp = await lctx.newPage();
const authNet = [], loginLog = [];
lp.on("response", (r) => { if (/\/auth\/v1\//.test(r.url())) authNet.push(`${r.request().method()} ${new URL(r.url()).pathname} -> ${r.status()}`); });
lp.on("requestfailed", (r) => authNet.push(`${r.method()} ${r.url().replace(/\?.*/, "")} FAILED ${r.failure()?.errorText}`));
lp.on("console", (m) => { if (m.type() === "error") loginLog.push(m.text().slice(0, 160)); });
try {
  await lp.goto(BASE + "/login", { waitUntil: "domcontentloaded" }); await lp.getByLabel("Email").fill(EMAIL); await lp.getByLabel("Password").fill(PASSWORD);
  await lp.getByRole("button", { name: /sign in|log in/i }).click(); await lp.waitForURL(/\/dashboard/, { timeout: 20000 });
} catch (e) {
  // Report WHY: the app's own visible error, the auth requests the browser made and their status, console errors and cookie NAMES (never values).
  const alertText = await lp.getByRole("alert").filter({ hasText: /\S/ }).first().innerText({ timeout: 1000 }).catch(() => "(no alert shown)");
  const cookieNames = (await lp.context().cookies()).map((c) => c.name).join(",") || "(none)";
  const why = `${e.message.split("\n")[0]} | url=${new URL(lp.url()).pathname} | alert="${alertText.slice(0, 160)}" | auth requests: ${authNet.join("; ") || "(none made)"} | console: ${loginLog.join(" // ") || "(none)"} | cookies: ${cookieNames}`;
  if (ART) { await lp.screenshot({ path: path.join(ART, "login-failure.png"), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(ART, "auth-diagnostics.json"), JSON.stringify({ url: lp.url(), alertText, authNet, loginLog, cookieNames }, null, 1)); }
  R("login", "FAIL", "could not sign in with E2E_EMAIL/E2E_PASSWORD: " + why.split(PASSWORD).join("***")); await browser.close(); finish();
}
const state = await lctx.storageState(); await lctx.close();
R("login", "PASS", "signed in through the real /login form");

// ---- discover ids from the real UI (no hard-coded ids); BLOCKED when the scratch user has no data for a dynamic route
const ctx0 = await browser.newContext({ storageState: state, viewport: { width: 1024, height: 800 } }), p0 = await ctx0.newPage();
const hrefOf = async (url, re) => { await p0.goto(BASE + url, { waitUntil: "networkidle" }).catch(() => {}); const hs = await p0.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href"))); return hs.find((h) => new RegExp(re).test(h || "")) || null; };
const reviewHref = await hrefOf("/revision", `^/revision/${UUID}$`), studyHref = await hrefOf("/study", `^/study/(ncert_chapter|ssc_topic|ssc_subtopic)/${UUID}$`);
let practiceHref = null;
try { await p0.goto(BASE + "/practice/new?scope=mixed", { waitUntil: "networkidle" }); const b = p0.getByRole("button", { name: /^(start|practice)/i }).first(); if (await b.count()) { await b.click(); await p0.waitForURL(new RegExp(`/practice/${UUID}`), { timeout: 15000 }); practiceHref = new URL(p0.url()).pathname + new URL(p0.url()).search; } } catch {}
await ctx0.close();

// ---- per route x viewport checks
async function inspect(route, w) {
  const ctx = await browser.newContext({ storageState: state, viewport: { width: w, height: 800 } }), page = await ctx.newPage(), problems = [], tag = `${route}@${w}`;
  if (ART) await ctx.tracing.start({ screenshots: true, snapshots: true }).catch(() => {});
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error" || m.type() === "warning" || /hydrat/i.test(t)) clog(tag, `console.${m.type()}: ${t.slice(0, 400)}`); if (m.type() === "error" || /hydrat/i.test(t)) problems.push(`console.${m.type()}: ${t.slice(0, 200)}`); });
  page.on("pageerror", (e) => { clog(tag, "pageerror: " + e.message); problems.push("pageerror: " + String(e.message).slice(0, 200)); });
  const tracker = trackFailures(page, BASE, (line) => { clog(tag, "requestfailed: " + line); problems.push("requestfailed: " + line.slice(0, 200)); }, (line) => clog(tag, "ignored (expected): " + line), (line) => { if (ART) fs.appendFileSync(path.join(ART, "server-actions.log"), `${tag} ${line}\n`); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE) && !/favicon/.test(r.url())) { clog(tag, `HTTP ${r.status()} ${r.url()}`); problems.push(`HTTP ${r.status()} ${r.url().slice(BASE.length, BASE.length + 100)}`); } });
  let status = 0; try { const r = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30000 }); status = r?.status() ?? 0; } catch (e) { problems.push("navigation: " + e.message.split("\n")[0]); }
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const vw = window.innerWidth, over = document.documentElement.scrollWidth - vw;
    const clipped = [...document.querySelectorAll("*")].filter((el) => { const cs = getComputedStyle(el); if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") return false; const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > vw + 1); }).map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "")).slice(0, 3);
    const small = [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary")].filter((el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && (r.height < 40 || r.width < 40) && !el.closest("[data-inline]") && !(el.tagName === "A" && el.closest("p, li, span") && el.parentElement && el.parentElement.tagName !== "LI" && r.height >= 16 && getComputedStyle(el).display === "inline"); }).length;
    return { over, clipped, small, h1: document.querySelector("h1")?.textContent?.trim() ?? null, text: document.body.innerText.slice(0, 300) };
  });
  await tracker.settle();
  if (m.over > 1) problems.push(`horizontal overflow ${m.over}px`);
  if (m.clipped.length) problems.push("fixed element clipped by viewport: " + m.clipped.join(","));
  if (status >= 400) problems.push("document status " + status);
  if (/\/login/.test(page.url()) && !route.startsWith("/login")) problems.push("redirected to /login (session lost)");
  const note = "";
  if (problems.length && ART) await page.screenshot({ path: path.join(ART, `${slug(tag)}.png`), fullPage: true }).catch(() => {});
  R(`${route} @${w}px`, problems.length ? "FAIL" : "PASS", problems.length ? problems.slice(0, 6).join(" | ") : `HTTP ${status}${m.small ? `, ${m.small} controls under 40px (informational)` : ""}${note}`);
  // links (once, at 390): every same-origin link on the page must not 404/500
  if (w === 390) {
    const hrefs = [...new Set(await page.$$eval("a[href^='/']", (as) => as.map((a) => a.getAttribute("href"))))].filter((h) => !/^\/(api|_next|logout)/.test(h)).slice(0, 40), bad = [];
    for (const h of hrefs) { try { const r = await ctx.request.get(BASE + h, { maxRedirects: 5, timeout: 15000 }); if (r.status() >= 400) bad.push(`${h} -> ${r.status()}`); } catch (e) { bad.push(`${h} -> ${e.message.split("\n")[0]}`); } }
    R(`${route} links @390px`, bad.length ? "FAIL" : "PASS", bad.length ? bad.join(" | ") : `${hrefs.length} same-origin links resolve`);
  }
  if (axeSource && (w === 390 || w === 1024)) {
    await page.evaluate(axeSource); const ax = await page.evaluate(async () => await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } }));
    const bad = ax.violations.filter((v) => v.impact === "serious" || v.impact === "critical"); if (ART && ax.violations.length) fs.writeFileSync(path.join(ART, `axe_${slug(tag)}.json`), JSON.stringify(ax.violations, null, 1)); A(`axe ${route} @${w}px`, bad.length ? "FAIL" : "PASS", bad.length ? bad.map((v) => `${v.id}(${v.nodes.length})`).join(", ") : `${ax.violations.length} minor/moderate, 0 serious/critical`);
  }
  tracker.setClosing();
  if (ART) await ctx.tracing.stop(problems.length ? { path: path.join(ART, `${slug(tag)}.trace.zip`) } : undefined).catch(() => {});
  await ctx.close();
}
for (const w of VIEWPORTS) for (const r of ROUTES) await inspect(r, w);
for (const w of VIEWPORTS) { if (reviewHref) await inspect(reviewHref, w); else R(`/revision/[id] @${w}px`, "BLOCKED", "no open revision for the scratch user (seed a due revision)"); if (studyHref) await inspect(studyHref, w); else R(`${"/study/[type]/[id]"} @${w}px`, "BLOCKED", "no study item link found on /study"); if (practiceHref) await inspect(practiceHref, w); else R(`/practice/[sessionId] @${w}px`, "BLOCKED", "could not start a practice session (needs PYQs mapped to an item)"); }
if (!axeSource) A("axe-core", "NOT RUN", "axe-core is not installed (npm i -D axe-core); no WCAG automation was run");

// ---- flows at 390px
const flowCtx = async () => { const c = await browser.newContext({ storageState: state, viewport: { width: 390, height: 800 } }); if (ART) await c.tracing.start({ screenshots: true, snapshots: true }).catch(() => {}); return c; };
const flow = async (name, fn, blocked) => {
  if (blocked) return R(name, "BLOCKED", blocked); const ctx = await flowCtx(); let failed = false;
  try { await fn(ctx); R(name, "PASS", ""); } catch (e) { failed = true; clog(name, "flow failed: " + e.message); R(name, e.blocked ? "BLOCKED" : "FAIL", e.message.split("\n")[0]); if (ART) { let i = 0; for (const pg of ctx.pages()) await pg.screenshot({ path: path.join(ART, `${slug(name)}_${i++}.png`), fullPage: true }).catch(() => {}); } }
  finally { if (ART) await ctx.tracing.stop(failed ? { path: path.join(ART, `${slug(name)}.trace.zip`) } : undefined).catch(() => {}); await ctx.close(); }
};
const expectText = async (page, re, t = 8000) => { await page.getByText(re).first().waitFor({ timeout: t }); };
await flow("flow: revision review (recall -> reveal -> confidence -> rate -> result -> next)", async (ctx) => {
  const page = await ctx.newPage(); await page.goto(BASE + reviewHref, { waitUntil: "networkidle" }); await expectText(page, /Can you still recall this\?/);
  if (await page.getByRole("radio", { name: /Hard|Good|Easy/ }).count()) throw new Error("rating controls visible before the material was revealed");
  await page.getByRole("button", { name: "Show the material" }).click(); const save = page.getByRole("button", { name: "Save review" });
  if (!(await save.isDisabled())) throw new Error("Save review enabled before a rating was chosen");
  await pickRadio(page, /^5\b/); await pickRadio(page, /^Good\b/);
  const body = await page.locator("body").innerText(); if (!/Next review: /.test(body)) throw new Error("no server-previewed next review shown");
  await save.dblclick(); await expectText(page, /Review complete/, 15000); await expectText(page, /Next review/); const next = await page.getByRole("link", { name: /Next revision|Back to queue|caught up/i }).count(); if (!next) throw new Error("no next-action link after the result");
}, reviewHref ? null : "no open revision for the scratch user");
await flow("flow: revision stale tab (second tab reviews first; first tab must say 'already updated elsewhere')", async (ctx) => {
  const a = await ctx.newPage(), b = await ctx.newPage(); for (const p of [a, b]) { await p.goto(BASE + reviewHref, { waitUntil: "networkidle" }); if (!(await p.getByText(/Can you still recall this\?/).count())) throw Object.assign(new Error("the revision is already complete (graduated by the previous flow): seed a second open revision"), { blocked: true }); await p.getByRole("button", { name: "Show the material" }).click(); await pickRadio(p, /^Good\b/); }
  await a.getByRole("button", { name: "Save review" }).click(); await expectText(a, /Review complete|already updated|already completed/, 15000);
  await b.getByRole("button", { name: "Save review" }).click(); const t = await waitForAlertText(b, /already updated elsewhere|already completed|saved/i).catch(async () => `(no matching alert; alerts: ${JSON.stringify(await b.getByRole("alert").allInnerTexts())})`); if (!/already updated elsewhere|already completed|saved/i.test(t)) throw new Error("stale submit not reported: " + t);
}, reviewHref ? null : "no open revision for the scratch user");
await flow("flow: study session (start, pause, resume, finish) and revision stays independent", async (ctx) => {
  const page = await ctx.newPage(); await page.goto(BASE + studyHref, { waitUntil: "networkidle" });
  const before = await page.locator("#revision").innerText().catch(() => "");
  await page.getByRole("button", { name: /Start studying|Continue/ }).first().click(); await page.getByRole("timer").first().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Pause" }).first().click(); await page.waitForFunction(() => /paused/i.test(document.querySelector("[role=timer]")?.getAttribute("aria-label") || ""));
  await page.getByRole("button", { name: "Resume" }).first().click(); await page.waitForFunction(() => /studying/i.test(document.querySelector("[role=timer]")?.getAttribute("aria-label") || ""));
  await page.getByRole("button", { name: "Finish" }).first().click(); await expectText(page, /Session complete/, 15000); await page.reload({ waitUntil: "networkidle" });
  const after = await page.locator("#revision").innerText().catch(() => ""); const line = (t) => (t.split("\n").find((l) => /revision|overdue|due/i.test(l) && !/^Revision$/i.test(l)) || "").trim();
  if (line(before) !== line(after) && !/Review/.test(after)) throw new Error(`revision state changed by studying: "${line(before)}" -> "${line(after)}"`);
}, studyHref ? null : "no study item link found on /study");
await flow("flow: practice (answer, server grading, summary)", async (ctx) => {
  const page = await ctx.newPage(); await page.goto(BASE + practiceHref, { waitUntil: "networkidle" });
  for (let i = 0; i < 60; i++) {
    if (await page.getByRole("heading", { name: /Session summary/ }).count()) break;
    const radios = page.getByRole("radio"); if (await radios.count()) { await pickRadio(page, null); await page.getByRole("button", { name: "Submit answer" }).click(); await page.getByRole("heading", { name: /Correct|Incorrect/ }).first().waitFor({ timeout: 10000 }); }
    const nxt = page.getByRole("button", { name: /Next question|See summary/ }); if (await nxt.count()) await nxt.click(); else break;
    // the next question (or the summary) is fetched from the server after the click: wait for it instead of sampling the loading skeleton
    await page.getByRole("radio").or(page.getByRole("heading", { name: /Session summary/ })).first().waitFor({ timeout: 15000 });
  }
  await expectText(page, /Session summary/, 15000);
}, practiceHref ? null : "could not start a practice session");

// ---- Phase 8 workspace flows (tasks, notes, resources): every write goes through the real UI and is read back from the server
const uniq = (k) => `E2E ${k} ${Date.now().toString(36)}`;
const gone = async (loc, t = 15000) => { await loc.first().waitFor({ state: "detached", timeout: t }); };
await flow("flow: tasks (create due today -> dashboard 'Tasks due today' -> complete -> reopen -> delete only after confirmation)", async (ctx) => {
  const page = await ctx.newPage(), title = uniq("task");
  await page.goto(BASE + "/tasks/new", { waitUntil: "networkidle" });
  await page.locator("input[name=title]").fill(title); await page.locator("select[name=priority]").selectOption("high");
  await page.getByRole("button", { name: "Add task" }).click(); await page.waitForURL(/\/tasks$/, { timeout: 15000 });
  const open = page.locator("section[aria-labelledby=open-h]"), done = page.locator("section[aria-labelledby=done-h]");
  await open.getByText(title).waitFor({ timeout: 10000 });
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  const due = page.locator("section[aria-labelledby=due-tasks]"); await due.getByText(title).waitFor({ timeout: 10000 });
  await due.getByRole("button", { name: `${title}: mark as done` }).click(); await gone(due.getByText(title));
  await page.goto(BASE + "/tasks", { waitUntil: "networkidle" }); await done.getByText(title).waitFor({ timeout: 10000 });
  if (await open.getByText(title).count()) throw new Error("a completed task is still listed as open");
  await done.getByRole("button", { name: `${title}: completed, mark as not done` }).click(); await open.getByText(title).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: `Delete ${title}` }).click(); await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(500); if (!(await open.getByText(title).count())) throw new Error("Cancel deleted the task");
  await page.getByRole("button", { name: `Delete ${title}` }).click(); await page.getByRole("button", { name: "Delete", exact: true }).click();
  await gone(page.getByText(title)); await page.reload({ waitUntil: "networkidle" });
  if (await page.getByText(title).count()) throw new Error("the deleted task came back after a reload");
});
await flow("flow: notes (create on a learning item -> search -> edit -> delete after confirmation)", async (ctx) => {
  const page = await ctx.newPage(), title = uniq("note"), word = `zq${Date.now().toString(36)}`;
  await page.goto(BASE + "/notes/new", { waitUntil: "networkidle" });
  const sel = page.locator("select[name=link]"); const first = await sel.locator("option").nth(1).getAttribute("value");
  if (!first) throw Object.assign(new Error("no learning item to attach a note to (seed progress for the scratch user)"), { blocked: true });
  await sel.selectOption(first); await page.locator("input[name=title]").fill(title); await page.locator("textarea[name=content]").fill(`first draft ${word}`);
  await page.getByRole("button", { name: "Save note" }).click(); await page.waitForURL(/\/notes$/, { timeout: 15000 });
  await page.getByRole("searchbox").or(page.locator("input[name=q]")).first().fill(word); await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`[?&]q=${word}`), { timeout: 10000 }); await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/notes\/[0-9a-f-]{36}$/, { timeout: 10000 });
  await page.locator("textarea[name=content]").fill(`edited ${word}`); await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("status").filter({ hasText: "Note saved" }).waitFor({ timeout: 10000 });
  await page.reload({ waitUntil: "networkidle" }); if ((await page.locator("textarea[name=content]").inputValue()) !== `edited ${word}`) throw new Error("the edit did not persist");
  await page.getByRole("button", { name: `Delete ${title}` }).click(); await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForURL(/\/notes$/, { timeout: 15000 }); await page.waitForLoadState("networkidle");
  if (await page.getByText(title).count()) throw new Error("the deleted note is still listed");
});
await flow("flow: resources (official is read-only, saved link opens safely in a new tab, unsafe stored URL is not a link, delete after confirmation)", async (ctx) => {
  const page = await ctx.newPage(), title = uniq("resource"), url = `https://example.test/${Date.now().toString(36)}`;
  await page.goto(BASE + "/resources/new", { waitUntil: "networkidle" });
  await page.locator("input[name=title]").fill(title); await page.locator("input[name=url]").fill(url); await page.locator("select[name=type]").selectOption("pdf");
  await page.getByRole("button", { name: "Save resource" }).click(); await page.waitForURL(/\/resources$/, { timeout: 15000 });
  const a = page.locator(`a[href="${url}"]`); await a.waitFor({ timeout: 10000 });
  if ((await a.getAttribute("target")) !== "_blank" || !/noopener/.test((await a.getAttribute("rel")) ?? "")) throw new Error("a saved link must open in a new tab with rel=noopener");
  const official = page.locator("section[aria-labelledby=off-h] li").filter({ hasText: "CI Fixture official notice" });
  if (!(await official.count())) throw Object.assign(new Error("no official resource seeded"), { blocked: true });
  if (await official.getByRole("button", { name: /Delete/ }).count()) throw new Error("official resources must be read-only (a delete button is shown)");
  if (await page.locator('a[href^="javascript:" i], a[href^="data:" i]').count()) throw new Error("an unsafe stored URL was rendered as a link");
  if (!(await page.getByText("CI Fixture unsafe link").count())) throw new Error("the resource with an unsafe URL should still be listed (as plain text)");
  await page.getByRole("button", { name: `Delete ${title}` }).click(); await page.getByRole("button", { name: "Delete", exact: true }).click();
  await gone(page.locator(`a[href="${url}"]`)); await page.reload({ waitUntil: "networkidle" });
  if (await page.locator(`a[href="${url}"]`).count()) throw new Error("the deleted resource came back after a reload");
});

// ---- Phase 9 flows (search, settings, analytics): real UI, values read back from the server
await flow("flow: search (page: too short / no match / hits; Ctrl+K palette opens, finds, closes on Escape)", async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(BASE + "/search?q=a", { waitUntil: "networkidle" });
  await page.getByText("Type at least two characters.").waitFor({ timeout: 10000 });
  await page.goto(BASE + "/search?q=zzqxnomatch", { waitUntil: "networkidle" });
  await page.getByText(/Nothing found for/).waitFor({ timeout: 10000 });
  await page.goto(BASE + "/search", { waitUntil: "networkidle" });
  await page.getByRole("searchbox").fill("fixture"); await page.keyboard.press("Enter"); await page.waitForURL(/[?&]q=fixture/, { timeout: 10000 });
  const hits = page.locator("main section[aria-label] ul li a, section[aria-label] ul li a"); await hits.first().waitFor({ timeout: 10000 });
  if (!(await hits.count())) throw Object.assign(new Error("no search hits for the seeded 'CI Fixture' rows"), { blocked: true });
  await page.keyboard.press("Control+k"); const dlg = page.getByRole("dialog", { name: "Search" }); await dlg.waitFor({ timeout: 5000 });
  await dlg.getByRole("textbox", { name: "Search" }).fill("fixture"); await dlg.locator("a").first().waitFor({ timeout: 10000 });
  await page.keyboard.press("Escape"); await dlg.waitFor({ state: "detached", timeout: 5000 });
});
await flow("flow: settings (invalid ladder is refused, valid save persists after reload, original restored)", async (ctx) => {
  const page = await ctx.newPage(); await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
  const name = page.locator("input[name=display_name]"), goal = page.locator("input[name=daily_goal_minutes]"), ladder = page.locator("input[name=revision_intervals]");
  const orig = { name: await name.inputValue(), goal: await goal.inputValue(), ladder: await ladder.inputValue() };
  const save = async () => { await page.getByRole("button", { name: "Save settings" }).click(); };
  try {
    await ladder.fill("7, 3, 1"); await save(); await page.getByRole("alert").filter({ hasText: /Revision ladder/ }).waitFor({ timeout: 10000 });
    await page.reload({ waitUntil: "networkidle" }); if ((await ladder.inputValue()) !== orig.ladder) throw new Error("an invalid ladder was saved");
    const nm = `E2E ${Date.now().toString(36)}`; await name.fill(nm); await goal.fill("95"); await ladder.fill("2, 5, 10, 20"); await save();
    await page.getByRole("status").filter({ hasText: "Settings saved" }).waitFor({ timeout: 10000 });
    await page.reload({ waitUntil: "networkidle" });
    if ((await name.inputValue()) !== nm || (await goal.inputValue()) !== "95" || (await ladder.inputValue()) !== "2, 5, 10, 20") throw new Error("saved settings did not persist after a reload");
    await page.goto(BASE + "/analytics", { waitUntil: "networkidle" }); const body = await page.locator("main").innerText();
    if (!/goal 95 min\/day/.test(body) && !/Nothing to analyse yet/.test(body)) throw new Error("analytics did not pick up the new daily goal");
  } finally {
    await page.goto(BASE + "/settings", { waitUntil: "networkidle" }); await name.fill(orig.name); await goal.fill(orig.goal); await ladder.fill(orig.ladder); await save();
    await page.getByRole("status").filter({ hasText: "Settings saved" }).waitFor({ timeout: 10000 }).catch(() => {});
  }
});
await flow("flow: analytics (real numbers only: no NaN/undefined/Infinity, sections present)", async (ctx) => {
  const page = await ctx.newPage(); await page.goto(BASE + "/analytics", { waitUntil: "networkidle" });
  const body = await page.locator("main").innerText();
  if (/NaN|undefined|Infinity|\[object/.test(body)) throw new Error("analytics shows a broken value: " + body.match(/NaN|undefined|Infinity|\[object/)[0]);
  if (/Nothing to analyse yet/.test(body)) return;
  for (const h of ["Study time, last 14 days", "Mastery", "Revision, last 30 days"]) await page.getByRole("heading", { name: h }).waitFor({ timeout: 5000 });
  if (!(await page.getByRole("list", { name: "Minutes studied per day" }).locator("li").count() === 14)) throw new Error("the study-time chart must have exactly 14 days");
});

// ---- accessibility checks on the real app (390px)
const a11yCtx = await flowCtx();
if (reviewHref) { const p = await a11yCtx.newPage(); try {
  await p.goto(BASE + reviewHref, { waitUntil: "networkidle" }); await p.getByRole("button", { name: "Show the material" }).click();
  const fs_ = await p.evaluate(() => [...document.querySelectorAll("input[type=radio]")].every((r) => r.closest("fieldset")?.querySelector("legend"))); A("review: radios live in a fieldset with a legend", fs_ ? "PASS" : "FAIL", "");
  await p.getByRole("radio", { name: /Hard/ }).focus(); await p.keyboard.press("ArrowRight"); A("review: arrow keys move within the rating radio group", (await p.getByRole("radio", { name: /Good/ }).isChecked()) ? "PASS" : "FAIL", "");
  A("review: Save review is disabled until a rating is chosen", (await p.getByRole("button", { name: "Save review" }).isDisabled()) !== (await p.getByRole("radio", { checked: true }).count() > 0) ? "PASS" : "FAIL", "");
  await p.getByRole("button", { name: "Details" }).click(); A("review: Details sheet is a modal dialog and takes focus", (await p.evaluate(() => !!document.activeElement?.closest("dialog[open]"))) ? "PASS" : "FAIL", ""); await p.keyboard.press("Escape"); A("review: Escape closes the sheet", (await p.locator("dialog[open]").count()) === 0 ? "PASS" : "FAIL", "");
} catch (e) { A("review accessibility", "FAIL", e.message.split("\n")[0]); } } else A("review accessibility", "BLOCKED", "no open revision for the scratch user");
if (studyHref) { const p = await a11yCtx.newPage(); try {
  await p.goto(BASE + studyHref, { waitUntil: "networkidle" }); await p.getByRole("button", { name: /^Notes/ }).first().click(); await p.waitForTimeout(200);
  A("study: Notes sheet opens as a modal dialog with focus inside", (await p.evaluate(() => !!document.activeElement?.closest("dialog[open]"))) ? "PASS" : "FAIL", ""); await p.keyboard.press("Escape"); A("study: Escape closes the Notes sheet", (await p.locator("dialog[open]").count()) === 0 ? "PASS" : "FAIL", "");
} catch (e) { A("study accessibility", "FAIL", e.message.split("\n")[0]); } } else A("study accessibility", "BLOCKED", "no study item link found");
for (const route of ["/dashboard", "/revision", "/study"]) {
  const p = await a11yCtx.newPage(); await p.goto(BASE + route, { waitUntil: "networkidle" }).catch(() => {});
  const unlabeled = await p.evaluate(() => [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((el) => { const r = el.getBoundingClientRect(); if (!r.width) return false; const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`); return !(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || id || el.closest("label") || el.title); }).map((el) => el.outerHTML.slice(0, 80)));
  A(`${route}: every form control has an accessible name`, unlabeled.length ? "FAIL" : "PASS", unlabeled.join(" | "));
  const seen = [], noFocus = []; for (let i = 0; i < 12; i++) { await p.keyboard.press("Tab"); const f = await p.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return null; const cs = getComputedStyle(el); return { tag: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""), visible: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none" }; }); if (!f) continue; seen.push(f.tag); if (!f.visible) noFocus.push(f.tag); }
  A(`${route}: keyboard Tab reaches controls and each shows a visible focus indicator`, !seen.length ? "FAIL" : noFocus.length ? "FAIL" : "PASS", !seen.length ? "Tab never focused anything" : noFocus.length ? "no visible indicator on: " + noFocus.join(", ") : `${seen.length} stops checked`);
  await p.close();
}
await a11yCtx.close(); await browser.close(); finish();
