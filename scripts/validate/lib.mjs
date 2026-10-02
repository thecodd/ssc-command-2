// Shared helpers for scripts/validate_phase7.mjs. Cross-platform (Node >= 18, no bash). Never hides a failure.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const STATUS = { PASS: "PASS", FAIL: "FAIL", BLOCKED: "BLOCKED", NOT_RUN: "NOT RUN" };
export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
export const isWin = process.platform === "win32";

/** Runs a command, captures everything, never throws. */
export function run(cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = cp.spawnSync(cmd, args, { cwd: opts.cwd ?? root, input: opts.input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: opts.timeoutMs ?? 0, env: { ...process.env, ...(opts.env ?? {}) }, shell: opts.shell ?? (isWin && /\.(cmd|bat)$|^npm$|^npx$/.test(cmd)) });
  return { code: r.status ?? (r.error ? 127 : 1), signal: r.signal, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error ? String(r.error.code || r.error.message) : null, ms: Date.now() - t0 };
}
export const has = (cmd) => { const r = run(isWin ? "where" : "which", [cmd]); return r.code === 0; };

export class Report {
  constructor(dir) { this.dir = dir; this.stages = []; this.logs = path.join(dir, "logs"); fs.mkdirSync(this.logs, { recursive: true }); }
  log(name, text) { const f = path.join(this.logs, name.replace(/[^\w.-]+/g, "_")); fs.writeFileSync(f, text); return path.relative(root, f); }
  add(s) { this.stages.push({ id: "", title: "", status: STATUS.NOT_RUN, mandatory: true, category: "GATE", detail: "", items: [], log: null, ms: 0, ...s }); const x = this.stages.at(-1); console.log(`[${x.status.padEnd(8)}] ${x.id} ${x.title}${x.detail ? "  - " + x.detail.split("\n")[0].slice(0, 160) : ""}`); return x; }
  /** READY only if every mandatory stage actually PASSED and nothing failed anywhere. */
  verdict() {
    const mand = this.stages.filter((s) => s.mandatory), notPass = mand.filter((s) => s.status !== STATUS.PASS), failed = this.stages.filter((s) => s.status === STATUS.FAIL);
    return { ready: notPass.length === 0 && failed.length === 0, notPass, failed };
  }
}
export function mdTable(rows, head) { return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map((c) => String(c ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`)].join("\n"); }
