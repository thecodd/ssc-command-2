#!/usr/bin/env node
// Approximation of eslint-plugin-react-hooks `exhaustive-deps` + a check for malformed eslint directives. Supporting evidence ONLY (the real `npm run lint` is the authority).
// Uses the TypeScript compiler API (no stubs needed: it resolves declarations by scope, not by type). Exit 1 on any finding.
const fs = require("fs"), path = require("path"), cp = require("child_process");
const ts = require(path.join(process.env.TS_PATH || cp.execSync("npm root -g").toString().trim(), "typescript"));
const root = path.resolve(__dirname, "../..");
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { if (["node_modules", ".next", ".git", "reports", "dist"].includes(f)) continue; const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(f) && !/\.d\.ts$/.test(f) && files.push(p); } })(root);
let problems = 0; const P = (f, n, m) => { problems++; console.log(`${path.relative(root, f)}:${n}: ${m}`); };
const HOOKS = new Set(["useEffect", "useLayoutEffect", "useCallback", "useMemo", "useImperativeHandle"]);
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  text.split("\n").forEach((l, i) => { const m = /\beslint-(disable(?:-next-line|-line)?|enable)\b(.*)$/.exec(l); if (m && /\/\/|\/\*/.test(l.slice(0, m.index + 2))) { const rest = m[2].replace(/\*\/\s*$/, "").trim(); if (rest && !/^[\w@/-]+(\s*,\s*[\w@/-]+)*(\s+--\s.*)?$/.test(rest)) P(f, i + 1, `malformed eslint directive (rule list must contain only rule names; put the reason after " -- " or in a separate comment): ${m[0].trim().slice(0, 100)}`); } });
  if (!/\.(tsx|ts)$/.test(f)) continue;
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isComponentFn = (n) => (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n));
  // local declarations of a function scope
  function collectDecls(fn) {
    const m = new Map(); const add = (name, kind) => m.set(name, kind);
    (function visit(n) {
      if (n !== fn && isComponentFn(n)) { if (ts.isFunctionDeclaration(n) && n.name) add(n.name.text, "fn"); return; }
      if (ts.isVariableDeclaration(n)) {
        const init = n.initializer, call = init && ts.isCallExpression(init) ? init.expression.getText() : "";
        if (ts.isIdentifier(n.name)) add(n.name.text, /^(React\.)?useRef$/.test(call) ? "ref" : /^(React\.)?use(Callback|Memo)$/.test(call) ? "memo" : init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) ? "fn" : "value");
        else if (ts.isArrayBindingPattern(n.name)) n.name.elements.forEach((e, i) => { if (ts.isBindingElement(e) && ts.isIdentifier(e.name)) add(e.name.text, /^(React\.)?use(State|Reducer)$/.test(call) && i === 1 ? "setter" : "value"); });
        else n.name.elements?.forEach((e) => ts.isIdentifier(e.name) && add(e.name.text, "value"));
      }
      ts.forEachChild(n, visit);
    })(fn.body ?? fn);
    fn.parameters.forEach((p) => { if (ts.isIdentifier(p.name)) add(p.name.text, "param"); else p.name.elements?.forEach((e) => e.name && ts.isIdentifier(e.name) && add(e.name.text, "param")); });
    return m;
  }
  function enclosingFn(n) { for (let p = n.parent; p; p = p.parent) if (isComponentFn(p) && p.body) return p; return null; }
  (function visit(n) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOKS.has(n.expression.text) && n.arguments.length >= 2 && ts.isArrayLiteralExpression(n.arguments[1])) {
      const cb = n.arguments[0], deps = n.arguments[1].elements.map((e) => e.getText()), fn = enclosingFn(n);
      if (fn && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
        const decls = collectDecls(fn), inner = new Set(); const used = new Map();
        (function innerDecls(x) { if (ts.isVariableDeclaration(x) || ts.isParameter(x)) { const nm = x.name; const add = (b) => ts.isIdentifier(b) && inner.add(b.text); if (ts.isIdentifier(nm)) add(nm); else nm.elements?.forEach((e) => e.name && add(e.name)); } if (ts.isFunctionDeclaration(x) && x.name) inner.add(x.name.text); ts.forEachChild(x, innerDecls); })(cb);
        (function ids(x) {
          if (ts.isIdentifier(x)) { const par = x.parent; const isProp = (ts.isPropertyAccessExpression(par) && par.name === x) || (ts.isPropertyAssignment(par) && par.name === x) || (ts.isJsxAttribute(par) && par.name === x) || ts.isTypeReferenceNode(par) || ts.isBindingElement(par) && par.propertyName === x; if (!isProp && !inner.has(x.text) && decls.has(x.text)) { const kind = decls.get(x.text); if (kind === "value" || kind === "fn" || kind === "memo" || kind === "param") { let chain = x.text; let q = x; while (ts.isPropertyAccessExpression(q.parent) && q.parent.expression === q) { q = q.parent; chain = q.getText(); } used.set(x.text, chain); } } }
          ts.forEachChild(x, ids);
        })(cb.body);
        for (const [name, chain] of used) { const covered = deps.some((d) => d === name || d === chain || name === d.split(/[.?]/)[0] && d.includes(".") && chain.startsWith(d.replace(/\?/g, ""))); if (!covered) P(f, sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, `${n.expression.text}: missing dependency "${name}"${chain !== name ? ` (used as ${chain})` : ""}`); }
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
}
console.log(problems ? `hook deps / eslint directives: ${problems} finding(s)` : "hook deps / eslint directives: no findings");
process.exit(problems ? 1 : 0);
