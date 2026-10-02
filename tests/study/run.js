// Plain-Node test runner (no jest/vitest: dependencies can't be installed here). Compiles TS on the fly with the globally installed TypeScript.
// Usage: node tests/study/run.js     (set TS_PATH if typescript isn't at `npm root -g`)
const fs = require("fs"), path = require("path"), Module = require("module");
const ts = (() => {   // the project's own typescript first (node_modules), then TS_PATH, then a global install
  const root = path.resolve(__dirname, "../.."), tries = [() => require.resolve("typescript", { paths: [root] }), () => path.join(process.env.TS_PATH, "typescript"), () => path.join(require("child_process").execSync("npm root -g").toString().trim(), "typescript")];
  for (const t of tries) { try { return require(t()); } catch {} }
  throw new Error("typescript not found: run `npm install` (project) or set TS_PATH");
})();
const root = path.resolve(__dirname, "../..");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...a) { if (req.startsWith("@/")) req = path.join(root, req.slice(2)); return orig.call(this, req, ...a); };
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (m, file) => {
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: "commonjs", target: "es2020", jsx: "react-jsx", esModuleInterop: true } });
  m._compile(out.outputText, file);
};
const assert = require("assert");
let pass = 0, fail = 0; const failures = [];
global.t = async (name, fn) => { try { await fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; failures.push([name, e]); console.log("  FAIL " + name + "\n       " + (e && e.message || e)); } };
global.assert = assert;
(async () => {
  const files = fs.readdirSync(__dirname).filter((f) => /\.test\.ts$/.test(f)).sort();
  for (const f of files) { console.log(f); await require(path.join(__dirname, f)).default(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
