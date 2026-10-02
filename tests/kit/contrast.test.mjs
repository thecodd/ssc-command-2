// Contrast-safe design tokens (run #4 axe: serious color-contrast violations on metadata/nav text and violet badges). Pure computation of WCAG 2.x contrast
// ratios from tailwind.config.ts against every background those tokens sit on. The real-app axe stage remains the authority.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cfg = fs.readFileSync(path.join(root, "tailwind.config.ts"), "utf8").replace(/\/\/.*$/gm, "");
const tok = (re) => { const m = re.exec(cfg); assert.ok(m, `token not found: ${re}`); return m[1]; };
const T = { bg: tok(/\bbg: "(#[0-9A-Fa-f]{6})"/), surface: tok(/surface: "(#[0-9A-Fa-f]{6})"/), raised: tok(/raised: "(#[0-9A-Fa-f]{6})"/), ink: tok(/ink: "(#[0-9A-Fa-f]{6})"/), sub: tok(/sub: "(#[0-9A-Fa-f]{6})"/), mute: tok(/mute: "(#[0-9A-Fa-f]{6})"/),
  lime: tok(/lime: \{ DEFAULT: "(#[0-9A-Fa-f]{6})"/), violet: tok(/violet: \{ DEFAULT: "(#[0-9A-Fa-f]{6})"/), violetFg: tok(/violet: \{[^}]*fg: "(#[0-9A-Fa-f]{6})"/) };
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => { const [r, g, b] = rgb(h).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const mix = (fg, bg, a) => "#" + rgb(fg).map((c, i) => Math.round(c * a + rgb(bg)[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
// every background small text actually sits on: page, cards, raised controls, the lime-dim tint (1f = 12%) and violet/10 tints, the 95% translucent nav bar
const BACKGROUNDS = { bg: T.bg, surface: T.surface, raised: T.raised, "bg/95 nav": mix(T.bg, T.raised, 0.95) };
for (const base of ["bg", "surface", "raised"]) { BACKGROUNDS[`lime-dim on ${base}`] = mix(T.lime, T[base], 0x1f / 255); BACKGROUNDS[`violet/10 on ${base}`] = mix(T.violet, T[base], 0.1); }

test("text tokens meet WCAG AA (4.5:1) for normal-size text on every background they are used on", () => {
  for (const [name, fg] of Object.entries({ ink: T.ink, sub: T.sub, mute: T.mute, lime: T.lime, "violet-fg": T.violetFg }))
    for (const [bgName, bg] of Object.entries(BACKGROUNDS)) assert.ok(ratio(fg, bg) >= 4.5, `${name} ${fg} on ${bgName} ${bg}: ${ratio(fg, bg).toFixed(2)}:1 < 4.5`);
});
test("the run #4 offenders are really fixed: the old mute #71717A and raw violet #8B5CF6 as text would fail", () => {
  assert.ok(ratio("#71717A", T.raised) < 4.5 && ratio("#8B5CF6", BACKGROUNDS["violet/10 on surface"]) < 4.5, "sanity: the old values fail this check");
  assert.notEqual(T.mute.toUpperCase(), "#71717A"); assert.equal(T.violet.toUpperCase(), "#8B5CF6", "violet stays for borders/tints (visual language preserved)");
  assert.ok(ratio(T.sub, T.bg) > ratio(T.mute, T.bg), "hierarchy kept: mute stays dimmer than sub");
});
test("no component sets text in raw violet or in the old grey: text uses violet-fg / mute tokens only", () => {
  const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx|ts|css)$/.test(f)) files.push(p); } })(path.join(root, "app")); (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx|ts)$/.test(f)) files.push(p); } })(path.join(root, "components"));
  const bad = [];
  for (const f of files) { const s = fs.readFileSync(f, "utf8"); if (/(?<![\w-])(?:[\w-]+:)*text-violet(?![\w-]|\/)/.test(s)) bad.push(`${path.relative(root, f)}: text-violet (use text-violet-fg)`); if (/#71717A|#8B5CF6/i.test(s)) bad.push(`${path.relative(root, f)}: hard-coded legacy colour`); if (/text-(zinc|gray|neutral|slate)-(500|600|700)/.test(s)) bad.push(`${path.relative(root, f)}: low-contrast palette grey`); }
  assert.deepEqual(bad, []);
  assert.match(fs.readFileSync(path.join(root, "components/ui/Badge.tsx"), "utf8"), /violet: "border-violet\/40 bg-violet\/10 text-violet-fg"/);
});
test("focus indicator stays clearly visible (lime outline >= 3:1 against every background)", () => {
  const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8"); const m = /:focus-visible \{ outline: 2px solid (#[0-9A-Fa-f]{6})/.exec(css); assert.ok(m);
  for (const [n, bg] of Object.entries(BACKGROUNDS)) assert.ok(ratio(m[1], bg) >= 3, `focus outline on ${n}`);
});
