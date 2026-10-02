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
