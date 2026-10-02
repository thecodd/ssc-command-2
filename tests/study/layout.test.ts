import * as fs from "fs";
import * as path from "path";
// STRUCTURAL layout checks over the JSX text. They catch class-level regressions (touch targets, safe-area, overflow guards, breakpoint contracts).
// They do NOT render anything: real 360/390/412/768/1024/1440px behaviour still needs a browser pass.
const root = path.join(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const dirs = ["components/study", "components/practice", "components/revision"];
const files = dirs.flatMap((d) => fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith(".tsx")).map((f) => `${d}/${f}`));
const TARGET = /\bbtn(-primary|-ghost)?\b|min-h-\[(44|48|52|56|64)px\]|\bh-(11|12|14)\b|\bpy-(3|4)\b/;
/** Attribute text of the JSX tag that starts at `i` (brace/quote aware, so `=>` inside handlers doesn't end it). */
function tagAttrs(s: string, i: number): string {
  let depth = 0, q = ""; const st = i;
  for (; i < s.length; i++) { const c = s[i]; if (q) { if (c === q && s[i - 1] !== "\\") q = ""; continue; } if (c === '"' || c === "'" || c === "`") { q = c; continue; } if (c === "{") depth++; else if (c === "}") depth--; else if (c === ">" && depth === 0) break; }
  return s.slice(st, i);
}
const hasHit = (cls: string) => TARGET.test(cls);

export default async function () {
  await t("layout: every <button> and in-flow <a>/<Link> in study/practice components has a 44px target class", () => {
    const bad: string[] = [];
    for (const f of files) {
      const s = read(f);
      for (const m of s.matchAll(/<(button|Link|a)\b/g)) {
        const attrs = tagAttrs(s, m.index! + m[0].length);
        if (/type="radio"|aria-hidden/.test(attrs) && !/^<button/.test(m[0])) continue;
        if (/className="absolute inset-0/.test(attrs) || /\bdata-inline\b/.test(attrs)) continue;   // overlay links; in-sentence links (WCAG 2.5.8 inline exception)
        if (/className=\{className\}/.test(attrs)) continue;                       // OpenSheetButton: defaults to btn-ghost (checked below)                 // stretched-link overlay: the whole card is the target
        const cls = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(attrs);
        const text = cls ? (cls[1] ?? cls[2] ?? "") : (/className=\{/.test(attrs) ? attrs : "");
        if (!hasHit(text)) bad.push(`${f}: <${m[1]} ${attrs.replace(/\s+/g, " ").slice(0, 100)}`);
      }
    }
    assert.deepEqual(bad, []);
  });
  await t("layout: OpenSheetButton defaults to a 44px button", () => { assert.match(read("components/study/NotesSheet.tsx"), /className = "btn-ghost"/); });
  await t("layout: the phone action bar is fixed to the bottom, honours the safe area and is hidden at lg (the header takes over)", () => {
    const s = read("components/study/StickyBar.tsx");
    assert.match(s, /fixed inset-x-0 bottom-0/); assert.match(s, /pb-\[env\(safe-area-inset-bottom\)\]/); assert.match(s, /lg:hidden/);
    const h = read("components/study/StudyHeader.tsx");
    assert.match(h, /hidden shrink-0 lg:block"><SessionClock/);            // clock is NOT in the 360px header
    assert.match(h, /pt-\[env\(safe-area-inset-top\)\]/);
  });
  await t("layout: page content clears the fixed bar (pb-36 on phones) and the grid collapses to one column below lg", () => {
    const s = read("components/study/StudyScreen.tsx");
    assert.match(s, /pb-36/); assert.match(s, /lg:pb-16/); assert.match(s, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/); assert.match(s, /min-w-0 space-y-8/);
    assert.match(s, /break-words/);                                        // long titles wrap instead of widening the page
  });
  await t("layout: practice screen reserves room for its fixed submit bar and uses safe-area padding", () => {
    const q = read("components/practice/QuestionView.tsx"), r = read("components/practice/PracticeRunner.tsx");
    assert.match(q, /safe-area-inset-bottom/); assert.match(r, /pb-32/); assert.match(r, /pt-\[env\(safe-area-inset-top\)\]/);
  });
  await t("layout: no fixed pixel widths above 340 in study/practice components (would overflow at 360px)", () => {
    const bad: string[] = [];
    for (const f of files) for (const m of read(f).matchAll(/\b(?:w|min-w|max-w)-\[(\d+)px\]/g)) if (+m[1] > 340 && !/lg:|md:|sm:/.test(read(f).slice(Math.max(0, m.index! - 6), m.index!))) bad.push(`${f}: ${m[0]}`);
    assert.deepEqual(bad.filter((b) => !/lg:grid-cols/.test(b)), []);
  });
  await t("layout: text inputs are 16px on phones (no iOS zoom) and sheets cap their height", () => {
    assert.match(read("components/ui/ActionForm.tsx"), /text-base[^"]*lg:text-sm/);
    assert.match(read("components/ui/Sheet.tsx"), /max-h-\[88dvh\]/); assert.match(read("components/ui/Sheet.tsx"), /safe-area-inset-bottom/);
  });
}
