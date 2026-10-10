// Cross-platform (Windows/macOS/Linux): applies database/migrations/001..014 to the LINKED Supabase project.
// Safe order: copy -> dry-run (changes nothing, shows the plan) -> ask y/N -> real push.
// Usage:  node scripts/deploy/push-migrations.mjs        (project must already be linked: supabase link)
import { readdirSync, mkdirSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { join } from "node:path";

const src = "database/migrations", dst = join("supabase", "migrations");
if (!existsSync(src)) { console.error("Run this from the repo root (the folder that contains database/)."); process.exit(1); }
const files = readdirSync(src).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
if (files.length !== 14) { console.error(`Expected 14 migrations, found ${files.length}. Stop.`); process.exit(1); }
rmSync(dst, { recursive: true, force: true }); mkdirSync(dst, { recursive: true });
files.forEach((f, i) => copyFileSync(join(src, f), join(dst, `20260101${String(i).padStart(6, "0")}_${f.replace(/^\d{3}_/, "")}`)));
console.log(`Copied ${files.length} migrations to ${dst}`);

const sb = (...a) => spawnSync("npx", ["--yes", "--package=supabase", "--", "supabase", ...a], { stdio: "inherit", shell: true }).status;
console.log("\n--- Already applied on the project (should be empty on a fresh project) ---");
sb("migration", "list", "--linked");
console.log("\n--- DRY RUN: what would be applied (changes nothing) ---");
if (sb("db", "push", "--dry-run") !== 0) { console.error("Dry run failed. Nothing was changed."); process.exit(1); }
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ans = (await rl.question("\nApply these to the linked Supabase project now? (y/N) ")).trim().toLowerCase(); rl.close();
if (ans !== "y") { console.log("Cancelled. Nothing was changed."); process.exit(0); }
const code = sb("db", "push");
console.log(code === 0 ? "\nMigrations applied. Next: node scripts/deploy/push-migrations.mjs is done; tell Claude 'migrations done'." : "\nPush failed. Copy the last error lines and send them to Claude.");
process.exit(code ?? 1);
