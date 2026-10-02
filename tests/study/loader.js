// Minimal TypeScript loader so the pure study modules (and fixtures) can run under plain Node: no React, no Next, no database.
const cp = require("child_process"), Module = require("module"), path = require("path"), fs = require("fs");
let ts; try { ts = require("typescript"); } catch { ts = require(cp.execSync("npm root -g").toString().trim() + "/typescript"); }   // local devDependency first, global as a fallback
const root = path.resolve(__dirname, "../..");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req.startsWith("@/")) { const base = path.join(root, req.slice(2)); for (const ext of [".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext)) return base + ext; }
  return orig.call(this, req, ...rest);
};
require.extensions[".ts"] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
module.exports = { root };
