import * as fs from "fs";
import * as path from "path";
declare const t: (name: string, fn: () => void | Promise<void>) => Promise<void>;
declare const assert: typeof import("assert");
declare const require: any;
const root = path.join(__dirname, "../..");
const read = (n: string) => fs.readFileSync(path.join(root, "public/samples", n), "utf8");
const FORBIDDEN = /is_official|is_verified|is_published|status|published/;
export default async function () {
  const { toImportData } = require(path.join(root, "lib/import/parse.ts"));
  await t("samples: the JSON sample names a source and declares no trust/publish flags", () => {
    const d = toImportData("json", read("import-sample.json"));
    assert.ok(d.source?.name, "source name missing");
    assert.ok(!FORBIDDEN.test(Object.keys(d.source).join(",")));
    for (const r of [...d.ncert, ...d.ssc, ...d.mappings]) assert.ok(!FORBIDDEN.test(Object.keys(r).join(",")), "row declares a forbidden flag");
  });
  await t("samples: the CSV sample names its source through a source row and declares no trust/publish flags", () => {
    const text = read("import-sample.csv");
    assert.ok(!FORBIDDEN.test(text.split("\n")[0]), "CSV header declares a forbidden column");
    const d = toImportData("csv", text);
    assert.ok(d.source?.name, "source name missing");
    assert.ok(d.ncert.length + d.ssc.length + d.mappings.length > 0);
  });
}
