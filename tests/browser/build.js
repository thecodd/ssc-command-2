// Bundles REAL app components (not the Next.js app) for a headless-Chromium smoke test. Needs only globally-installed react, react-dom, esbuild (via tsx), playwright.
// Stubs: next/link, next/navigation, lucide-react icons, server actions (never called: the fake APIs are injected). NO Tailwind CSS exists in this sandbox, so layout is NOT testable here.
const fs = require("fs"), path = require("path"), cp = require("child_process");
const G = cp.execSync("npm root -g").toString().trim();
const esbuild = require(path.join(G, "tsx/node_modules/esbuild"));
const root = path.resolve(__dirname, "../..");
const out = path.join(__dirname, "dist"); fs.mkdirSync(out, { recursive: true });
const actionStub = (file) => `export ` + "const _s = 1;\n" + [...fs.readFileSync(path.join(root, "app/actions", file + ".ts"), "utf8").matchAll(/export async function (\w+)/g)].map((m) => `export const ${m[1]} = async () => ({ ok: false, code: "unknown", error: "server action stubbed in the browser smoke" });`).join("\n");
const stubs = {
  "next/link": `import React from "react"; export default React.forwardRef(function Link({ href, children, prefetch, ...p }, ref) { return React.createElement("a", { href, ref, ...p }, children); });`,
  "next/navigation": `export const useRouter = () => ({ push: (h) => { (window.__nav = window.__nav || []).push(["push", h]); }, replace: (h) => { (window.__nav = window.__nav || []).push(["replace", h]); }, refresh: () => { (window.__nav = window.__nav || []).push(["refresh"]); }, back() {} });
export const usePathname = () => "/"; export const useSearchParams = () => new URLSearchParams(); export const notFound = () => { throw new Error("notFound"); };`,
  "lucide-react": `import React from "react"; const mk = (n) => (p) => React.createElement("svg", { "data-icon": n, "aria-hidden": p["aria-hidden"] ?? "true", width: 16, height: 16, className: p.className }); export default new Proxy({}, { get: (_, n) => (n === "__esModule" ? false : mk(String(n))) });
export const __proxy = 1;`,
};
const lucideNames = new Set(); (function walk(d) { for (const f of fs.readdirSync(d)) { if (["node_modules", ".next", ".git", "tests", "database", "docs"].includes(f)) continue; const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) for (const m of fs.readFileSync(p, "utf8").matchAll(/import \{([^}]*)\} from "lucide-react"/g)) m[1].split(",").forEach((n) => { const t = n.trim(); if (t && !t.startsWith("type ") && t !== "LucideIcon") lucideNames.add(t.split(" as ")[0]); }); } })(root);
stubs["lucide-react"] = `import React from "react"; const mk = (n) => (p) => React.createElement("svg", { "data-icon": n, "aria-hidden": "true", width: 16, height: 16, className: p && p.className });\n` + [...lucideNames].map((n) => `export const ${n} = mk("${n}");`).join("\n");
const plugin = { name: "stubs", setup(b) {
  b.onResolve({ filter: /^(next\/link|next\/navigation|lucide-react)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: stubs[a.path], loader: "js", resolveDir: root }));
  b.onResolve({ filter: /^@\/app\/actions\/(\w+)$/ }, (a) => ({ path: a.path, namespace: "action" }));
  b.onLoad({ filter: /.*/, namespace: "action" }, (a) => ({ contents: actionStub(a.path.split("/").pop()), loader: "js" }));
  b.onResolve({ filter: /learning_oracle\.js$/ }, () => ({ path: "oracle", namespace: "oracle" }));   // browser has no fs: the same 4-line rule as database/tests/reference/learning_oracle.js
  b.onLoad({ filter: /.*/, namespace: "oracle" }, () => ({ loader: "js", contents: `module.exports = { nextReview(step, rating, ladder, today) { const n = ladder.length, at = Math.max(Math.min(step, n - 1), 0); const tgt = rating === "easy" ? at + 2 : rating === "good" ? at + 1 : Math.max(at - 1, 0); const add = (d, k) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); }; if (tgt > n - 1) return { step: n, graduated: true, interval: null, due: null }; const interval = rating === "hard" ? ladder[0] : ladder[tgt]; return { step: tgt, graduated: false, interval, due: add(today, interval) }; } };` }));
} };
const common = { bundle: true, tsconfig: path.join(root, "tsconfig.json"), jsx: "automatic", nodePaths: [G], plugins: [plugin], logLevel: "error", define: { "process.env.NODE_ENV": '"development"' } };
(async () => {
  await esbuild.build({ ...common, entryPoints: [path.join(__dirname, "entry-ssr.tsx")], platform: "node", format: "cjs", outfile: path.join(out, "ssr.js") });
  await esbuild.build({ ...common, entryPoints: [path.join(__dirname, "entry-client.tsx")], platform: "browser", format: "iife", outfile: path.join(out, "client.js") });
  console.log("built", fs.statSync(path.join(out, "ssr.js")).size, fs.statSync(path.join(out, "client.js")).size);
})().catch((e) => { console.error(e.message); process.exit(1); });
