import { NEXT_STEPS, PUBLISH_STATUSES, canMove, isPublishKind, isPublishStatus } from "@/lib/admin/publish";
import * as fs from "fs";
import * as path from "path";
declare const t: (name: string, fn: () => void | Promise<void>) => Promise<void>;
declare const assert: typeof import("assert");
export default async function () {
  await t("publishing: offered steps are exactly the transitions the database allows (migration 011)", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../database/migrations/011_curriculum_publishing.sql"), "utf8");
    const allowed = new Set((sql.match(/not in \(([^)]*)\)/)![1].match(/'[a-z_]+>[a-z_]+'/g) ?? []).map((x) => x.replace(/'/g, "")));
    const offered = new Set(PUBLISH_STATUSES.flatMap((from) => NEXT_STEPS[from].map((s) => `${from}>${s.to}`)));
    for (const o of offered) assert.ok(allowed.has(o), `UI offers ${o} but the database refuses it`);
    assert.ok(offered.has("in_review>published") && offered.has("archived>published"), "publish and restore must be reachable");
    assert.strictEqual(canMove("draft", "published"), false, "a draft can never skip review");
    assert.strictEqual(canMove("published", "draft"), false, "published content can never go back to draft");
  });
  await t("publishing: unknown kinds and statuses are rejected before any request", () => {
    assert.ok(isPublishKind("book") && isPublishKind("ssc_exam") && !isPublishKind("chapters") && !isPublishKind(undefined));
    assert.ok(isPublishStatus("in_review") && !isPublishStatus("deleted") && !isPublishStatus(null));
  });
  await t("admin actions: every publishing action validates its input and the services re-check admin", () => {
    const act = fs.readFileSync(path.join(__dirname, "../../app/actions/admin.ts"), "utf8"), svc = fs.readFileSync(path.join(__dirname, "../../services/admin.ts"), "utf8");
    for (const fn of ["setPublishStatusAction", "verifySourceAction", "setExamOfficialAction"]) assert.ok(new RegExp(`export async function ${fn}[\\s\\S]*?isUuid`).test(act), `${fn} must validate ids`);
    const calls = svc.match(/await requireAdmin\(\)/g) ?? [];
    assert.ok(calls.length >= 12, "every admin service must call requireAdmin()");
    assert.ok(/export async function listPublishing[\s\S]{0,80}requireAdmin/.test(svc), "listPublishing must require admin");
  });
}
