// Regression tests for the REAL-route browser harness (tests/e2e): which network failures are tolerated, and how radios are operated.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import cp from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { classifyFailure } from "../e2e/network_filter.mjs";
import { pickRadio } from "../e2e/interactions.mjs";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const BASE = "http://127.0.0.1:3100";
const C = (o) => classifyFailure({ base: BASE, method: "GET", url: BASE + "/x", errorText: "net::ERR_ABORTED", startedAt: 1, failedAt: 2, ...o });

test("network filter: ONLY GET ?_rsc= aborts and navigation/close-aborted server actions are expected", () => {
  assert.equal(C({ url: BASE + "/study?_rsc=abc12" }).kind, "expected"); assert.equal(C({ url: BASE + "/revision?foo=1&_rsc=x" }).reason, "rsc-abort");
  // NOT tolerated
  assert.equal(C({ url: BASE + "/study" }).kind, "unexpected", "plain ERR_ABORTED is not blanket-ignored");
  assert.equal(C({ url: BASE + "/study?_rsc=1", errorText: "net::ERR_CONNECTION_REFUSED" }).kind, "unexpected", "non-abort errors on RSC are defects");
  assert.equal(C({ url: BASE + "/study?_rsc=1", errorText: "net::ERR_FAILED" }).kind, "unexpected");
  assert.equal(C({ method: "POST", url: BASE + "/study?_rsc=1" }).kind, "unexpected", "only GET RSC payloads");
  assert.equal(C({ url: "http://127.0.0.1:54321/rest/v1/x?_rsc=1" }).kind, "unexpected", "cross-origin failures are never tolerated");
  assert.equal(C({ url: "http://127.0.0.1:54321/auth/v1/token", method: "POST", errorText: "net::ERR_FAILED" }).kind, "unexpected", "the run #3 CORS failure stays a defect");
  // server actions
  const act = { method: "POST", url: BASE + "/study/ssc_topic/x", headers: { "Next-Action": "abc" } };
  assert.equal(C({ ...act, startedAt: 10, failedAt: 30, lastNavigationAt: 20 }).reason, "action-abort-on-navigation");
  assert.equal(C({ ...act, closing: true }).reason, "action-abort-on-close");
  assert.equal(C({ ...act, startedAt: 10, failedAt: 30, lastNavigationAt: null }).kind, "unexpected", "an action aborted with no navigation/close is a defect");
  assert.equal(C({ ...act, startedAt: 25, failedAt: 30, lastNavigationAt: 20 }).kind, "unexpected", "an action started AFTER the navigation was not cancelled by it");
  assert.equal(C({ ...act, headers: {}, closing: true }).kind, "unexpected", "a plain POST (not a server action) is never tolerated");
  assert.equal(C({ ...act, errorText: "net::ERR_EMPTY_RESPONSE", closing: true }).kind, "unexpected");
  // CDP can report ERR_ABORTED for a server action whose body the page read to the end: tolerated ONLY with that in-page proof
  assert.equal(C({ ...act, bodyDelivered: true }).reason, "action-abort-after-body-delivered");
  assert.equal(C({ ...act, bodyDelivered: false }).kind, "unexpected", "an action whose body the app did not fully receive stays a defect");
  assert.equal(C({ ...act, headers: {}, bodyDelivered: true }).kind, "unexpected", "body proof never excuses a plain POST");
  assert.equal(C({ ...act, errorText: "net::ERR_CONNECTION_RESET", bodyDelivered: true }).kind, "unexpected", "body proof only covers ERR_ABORTED");
});
test("network filter is wired into the route checks; HTTP >= 400, pageerror, hydration, login redirect, overflow and clipping are still reported", () => {
  const s = read("tests/e2e/real_routes.mjs");
  assert.match(s, /trackFailures\(page, BASE,/); assert.match(s, /tracker\.setClosing\(\);/); assert.doesNotMatch(s, /page\.on\("requestfailed", \(r\) => \{ if \(!\/favicon/);
  for (const re of [/r\.status\(\) >= 400/, /page\.on\("pageerror"/, /hydrat/, /redirected to \/login/, /horizontal overflow/, /fixed element clipped/, /document status/]) assert.match(s, re);
  assert.doesNotMatch(read("tests/e2e/network_filter.mjs"), /status\(\)/, "responses (4xx/5xx) are never classified by the failure filter");
});
test("radio interaction: the harness never calls .check() on the visually-hidden radios and uses pickRadio for review, stale-tab and practice flows", () => {
  const s = read("tests/e2e/real_routes.mjs"); assert.doesNotMatch(s, /\.check\(\)/); assert.ok((s.match(/pickRadio\(/g) ?? []).length >= 4);
  assert.match(s, /pickRadio\(page, \/\^Good\\b\/\)/); assert.match(s, /pickRadio\(p, \/\^Good\\b\/\)/); assert.match(s, /pickRadio\(page, null\)/);
  for (const f of ["components/revision/RatingControls.tsx", "components/study/ConfidenceScale.tsx", "components/practice/QuestionView.tsx"]) assert.match(read(f), /<label[\s\S]{0,200}<input type="radio"[^\n]{0,200}?className="peer sr-only"/, `${f}: radio stays a hidden input inside its <label> (accessible markup kept)`);
});
const pwLoad = () => { for (const t of [() => require(require.resolve("playwright", { paths: [root] })), () => require(path.join(cp.execSync("npm root -g").toString().trim(), "playwright"))]) { try { return t(); } catch {} } return null; };
test("radio interaction in REAL Chromium: with real sr-only CSS, check() is blocked by the label (the run #4 symptom) and pickRadio selects via the label", { timeout: 120000 }, async (t) => {
  const pw = pwLoad(); if (!pw) return t.skip("playwright not installed");
  const html = `<!doctype html><style>.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}
    label{display:block}span.card{display:flex;min-height:72px;border:1px solid #333;padding:8px}</style>
    <fieldset><legend>How did the recall go?</legend>${["Hard", "Good", "Easy"].map((r) => `<label><input type="radio" name="r" value="${r}" class="peer sr-only"><span class="card"><span>${r}</span><span>meaning</span></span></label>`).join("")}</fieldset>
    <fieldset><legend>Answer</legend>${["Delhi", "Mumbai"].map((o, i) => `<label><input type="radio" name="q" value="${i}" class="peer sr-only"><span class="card"><span aria-hidden="true">${"AB"[i]}</span><span>${o}</span></span></label>`).join("")}</fieldset>`;
  const srv = http.createServer((q, s) => { s.writeHead(200, { "content-type": "text/html" }); s.end(html); }); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  let browser; try { browser = await pw.chromium.launch({ args: ["--no-sandbox"] }); } catch (e) { srv.close(); return t.skip("chromium unavailable: " + e.message.split("\n")[0]); }
  try {
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    await assert.rejects(page.getByRole("radio", { name: /^Good\b/ }).check({ timeout: 1500 }), /intercepts pointer events|Timeout/, "check() on the hidden input is blocked by its label");
    await pickRadio(page, /^Good\b/); assert.equal(await page.getByRole("radio", { name: /^Good\b/ }).isChecked(), true); assert.equal(await page.getByRole("radio", { name: /^Hard\b/ }).isChecked(), false);
    await pickRadio(page, /^Mumbai$/); assert.equal(await page.getByRole("radio", { name: /^Mumbai$/ }).isChecked(), true);
  } finally { await browser.close(); await new Promise((r) => srv.close(r)); }
});

// ============================== run #6 regressions ==============================
const serve = async (html) => { const srv = http.createServer((q, s) => { s.writeHead(200, { "content-type": "text/html" }); s.end(typeof html === "function" ? html(q) : html); }); await new Promise((r) => srv.listen(0, "127.0.0.1", r)); return srv; };
const withBrowser = async (t, fn) => { const pw = pwLoad(); if (!pw) return t.skip("playwright not installed"); let b; try { b = await pw.chromium.launch({ args: ["--no-sandbox"] }); } catch (e) { return t.skip("chromium unavailable"); } try { await fn(b); } finally { await b.close(); } };
// Hand-written equivalents of exactly the Tailwind utilities involved (Tailwind itself is compiled only by the real build); geometry, not looks, is under test.
const TW = `*,::before,::after{box-sizing:border-box}body{margin:0}.min-h-dvh{min-height:100dvh}.w-full{width:100%}.mx-auto{margin-left:auto;margin-right:auto}.max-w-5xl{max-width:64rem}.px-4{padding-left:1rem;padding-right:1rem}
  .fixed{position:fixed}.inset-y-0{top:0;bottom:0}.left-0{left:0}.w-64{width:16rem}.hidden{display:none}.grid{display:grid}.gap-3{gap:.75rem}.flex{display:flex}.items-start{align-items:flex-start}.justify-between{justify-content:space-between}
  .min-w-0{min-width:0}.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.whitespace-nowrap{white-space:nowrap}.p-4{padding:1rem}.border{border:1px solid #333}
  .grid-cols-\\[minmax\\(0\\2c 1fr\\)\\]{grid-template-columns:minmax(0,1fr)}
  @media (min-width:768px){.md\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.md\\:grid-cols-\\[repeat\\(2\\2c minmax\\(0\\2c 1fr\\)\\)\\]{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media (min-width:1024px){.lg\\:flex{display:flex}.lg\\:ml-64{margin-left:16rem}.lg\\:pl-64{padding-left:16rem}.lg\\:px-10{padding-left:2.5rem;padding-right:2.5rem}}`;
const fromTsx = (file, re) => { const m = re.exec(read(file)); assert.ok(m, `${file}: ${re}`); return m[1]; };
test("layout (real Chromium): the app shell has NO horizontal overflow at 768/1024/1280/1440, the sidebar is 256px and <main> is centred in the remaining width (pre-fix shell overflowed by 256px)", { timeout: 120000 }, async (t) => {
  const shell = read("components/shell/AppShell.tsx"); const wrap = /<div className="([^"]*lg:pl-64[^"]*)">\s*<main className="([^"]+)"/.exec(shell); assert.ok(wrap, "main must sit in a wrapper that reserves the sidebar with lg:pl-64"); const classes = [...shell.matchAll(/className="([^"]*)"/g)].map((m) => m[1]).join(" "); assert.doesNotMatch(classes, /lg:ml-64/); assert.doesNotMatch(classes, /overflow-x-hidden/);
  const page = (wrapCls, mainCls) => `<!doctype html><style>${TW}</style><div class="min-h-dvh"><aside class="fixed inset-y-0 left-0 hidden w-64 lg:flex">side</aside>${wrapCls === null ? `<main class="${mainCls}">x</main>` : `<div class="${wrapCls}"><main class="${mainCls}">x</main></div>`}</div>`;
  const now = await serve(page(wrap[1], wrap[2])), old = await serve(page(null, "mx-auto w-full max-w-5xl px-4 lg:ml-64 lg:px-10"));
  try {
    await withBrowser(t, async (b) => {
      for (const w of [360, 768, 1024, 1280, 1440]) {
        const p = await b.newPage({ viewport: { width: w, height: 800 } }); await p.goto(`http://127.0.0.1:${now.address().port}/`);
        const g = await p.evaluate(() => { const m = document.querySelector("main").getBoundingClientRect(), a = document.querySelector("aside").getBoundingClientRect(); return { over: document.documentElement.scrollWidth - innerWidth, left: m.left, right: m.right, width: m.width, aside: a.width, vw: innerWidth }; });
        assert.equal(g.over, 0, `${w}px overflow ${g.over}`);
        if (w >= 1024) { assert.equal(g.aside, 256); const avail = w - 256; assert.ok(g.left >= 256 - 0.5, `${w}: main starts at ${g.left}`); assert.ok(Math.abs((g.left - 256) - (w - g.right)) <= 1, `${w}: centred in the remaining width`); assert.ok(g.width <= Math.min(avail, 1024) + 0.5); }
        else assert.equal(g.width, w, `${w}: mobile main is full width (unchanged)`);
        if (w === 1024) { await p.goto(`http://127.0.0.1:${old.address().port}/`); assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 256, "sanity: the pre-fix shell reproduces run #6's 256px"); }
        await p.close();
      }
    });
  } finally { now.close(); old.close(); }
});
test("layout (real Chromium): /syllabus card grid has NO overflow at 360/390/412 with a long one-line meta, and the card is not clipped (pre-fix grid overflowed exactly like run #6)", { timeout: 120000 }, async (t) => {
  const grid = fromTsx("app/(app)/syllabus/page.tsx", /<div className="(mt-1 grid [^"]+)">\{list\.map/), card = fromTsx("components/syllabus/ItemCard.tsx", /<article className="([^"]+)">/);
  assert.match(grid, /grid-cols-\[minmax\(0,1fr\)\]/); assert.match(card, /\bmin-w-0\b/); assert.doesNotMatch(read("app/(app)/syllabus/page.tsx") + read("components/syllabus/ItemCard.tsx"), /overflow-x-hidden/);
  const meta = "Class 6 · Geography · CI Fixture book (2024-25 edition) · Chapter 1 · Our Earth in the Solar System";
  const page = (g, c) => `<!doctype html><style>${TW}</style><main class="mx-auto w-full max-w-5xl px-4"><div class="${g.replace(/\bmt-1\b|\bpb-3\b/g, "")}"><article class="${c.replace(/\b(card|relative|block|transition|hover:\S+|focus-within:\S+)\b/g, "")} border">
    <div class="flex items-start justify-between gap-3"><div class="min-w-0"><p>Title</p><p class="truncate" id="meta">${meta}</p></div><span class="whitespace-nowrap" id="badge">In progress</span></div></article></div></main>`;
  const now = await serve(page(grid, card)), old = await serve(page("grid gap-3 md:grid-cols-2", "card relative block p-4"));
  try {
    await withBrowser(t, async (b) => {
      for (const w of [360, 390, 412]) {
        const p = await b.newPage({ viewport: { width: w, height: 800 } });
        await p.goto(`http://127.0.0.1:${old.address().port}/`); const before = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(before > 0, `sanity: pre-fix grid overflows at ${w}px`);
        await p.goto(`http://127.0.0.1:${now.address().port}/`);
        const g = await p.evaluate(() => { const a = document.querySelector("article").getBoundingClientRect(), b = document.getElementById("badge").getBoundingClientRect(), m = document.getElementById("meta"); return { over: document.documentElement.scrollWidth - innerWidth, aR: a.right, bR: b.right, vw: innerWidth, ell: m.scrollWidth > m.clientWidth }; });
        assert.equal(g.over, 0, `${w}px overflow ${g.over}`); assert.ok(g.aR <= g.vw && g.bR <= g.aR, `${w}: card and badge stay inside the viewport`); assert.equal(g.ell, true, "the long meta line is truncated with an ellipsis instead of widening the page");
        await p.close();
      }
    });
  } finally { now.close(); old.close(); }
});
test("stale-tab alert (real Chromium): Next's route announcer is an EMPTY role=alert that exists before the stale message, so getByRole('alert').first().waitFor() resolves to it at once and reads '' (run #6 'stale submit not reported: '); waitForAlertText waits for the real message", { timeout: 120000 }, async (t) => {
  const { waitForAlertText } = await import("../e2e/interactions.mjs");
  // faithful to Next 14: <next-route-announcer> at the end of <body>, an open shadow root with a 1px visually-hidden, initially EMPTY role="alert" live region
  const html = `<!doctype html><body><main><button id="save">Save review</button></main><next-route-announcer style="position:absolute"></next-route-announcer><script>
    const host = document.querySelector("next-route-announcer"); const sr = host.attachShadow({ mode: "open" }); const d = document.createElement("div"); d.setAttribute("role", "alert"); d.setAttribute("aria-live", "assertive"); d.id = "__next-route-announcer__";
    d.style.cssText = "position:absolute;border:0;height:1px;margin:-1px;padding:0;width:1px;clip:rect(0 0 0 0);overflow:hidden;white-space:nowrap;word-wrap:normal"; sr.appendChild(d);
    document.getElementById("save").onclick = () => setTimeout(() => { const s = document.createElement("section"); s.setAttribute("role", "alert"); s.innerHTML = "<h1>This revision was already updated elsewhere.</h1>"; document.querySelector("main").appendChild(s); }, 400);</script></body>`;
  const srv = await serve(html);
  try { await withBrowser(t, async (b) => {
    const base = `http://127.0.0.1:${srv.address().port}/`;
    let p = await b.newPage(); await p.goto(base); await p.getByRole("button", { name: "Save review" }).click();
    await p.getByRole("alert").first().waitFor({ timeout: 2000 }); assert.equal((await p.getByRole("alert").first().innerText()).trim(), "", "sanity: the OLD harness pattern reads the empty announcer");
    await p.close(); p = await b.newPage(); await p.goto(base); await p.getByRole("button", { name: "Save review" }).click();
    assert.equal(await waitForAlertText(p, /already updated elsewhere|already completed|saved/i), "This revision was already updated elsewhere.");
  }); } finally { srv.close(); }
  const s = read("tests/e2e/real_routes.mjs"); assert.match(s, /waitForAlertText\(b, \/already updated elsewhere\|already completed\|saved\/i\)/); assert.doesNotMatch(s, /b\.getByRole\("alert"\)\.first\(\)/);
});
test("practice feedback (real Chromium): the result is a HEADING the harness can wait for, plus a persistent status region; an explicit role=status on the h2 removed the heading (run #6 timeout)", { timeout: 120000 }, async (t) => {
  const qv = read("components/practice/QuestionView.tsx"); assert.match(qv, /<h2 id="fb-h" className="[^"]*">\{r\.is_correct \? "Correct"/); assert.doesNotMatch(qv, /<h2[^>]*role=/); assert.match(qv, /<p role="status" className="sr-only">/);
  const harness = read("tests/e2e/real_routes.mjs"); assert.match(harness, /getByRole\("heading", \{ name: \/Correct\|Incorrect\/ \}\)/); assert.match(harness, /name: \/Next question\|See summary\//); assert.match(harness, /Session summary/);
  const srv = await serve((q) => q.url === "/old" ? `<!doctype html><section><h2 role="status">Correct</h2></section>` : `<!doctype html><p role="status" class="sr-only">Correct</p><section aria-labelledby="h"><h2 id="h">Correct</h2></section>`);
  try { await withBrowser(t, async (b) => {
    const p = await b.newPage(); const base = `http://127.0.0.1:${srv.address().port}`;
    await p.goto(base + "/old"); assert.equal(await p.getByRole("heading", { name: /Correct|Incorrect/ }).count(), 0, "sanity: role=status hides the heading");
    await p.goto(base + "/new"); assert.equal(await p.getByRole("heading", { name: /Correct|Incorrect/ }).count(), 1); assert.equal(await p.getByRole("status").count(), 1);
  }); } finally { srv.close(); }
});
test("server-action aborts: same-document navigations are recorded as EVIDENCE but never excuse an abort; lifecycle evidence is written to server-actions.log", () => {
  const f = read("tests/e2e/network_filter.mjs"); assert.match(f, /page\.on\("framenavigated"[^\n]*navs\.push/); assert.doesNotMatch(f, /framenavigated[^\n]*lastNavigationAt =/);
  assert.match(f, /action FAILED/); assert.match(read("tests/e2e/real_routes.mjs"), /server-actions\.log/);
  assert.equal(C({ method: "POST", url: BASE + "/practice/x", headers: { "next-action": "a" }, startedAt: 10, failedAt: 30, lastNavigationAt: null }).kind, "unexpected");
});
