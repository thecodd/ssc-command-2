#!/usr/bin/env bash
# Builds database/tests/phase7/phase7_all.sql = phase4 harness (users A/B/C + fixtures) + 13_revision.sql, with @TOKEN@ -> fixed UUIDs.
# Run on a SCRATCH Supabase project AFTER migrations 001-014 (in order). SQL NOT EXECUTED by the author: no Postgres was available.
set -euo pipefail
cd "$(dirname "$0")"
python3 - <<'PY'
import re, uuid, pathlib
h = pathlib.Path("../phase4/00_harness.sql").read_text()
vec_marker = "\\ir ../reference/generated_vectors.sql"
h = h.replace(vec_marker, "")
text = h + "\n" + pathlib.Path("13_revision.sql").read_text()
text += """
-- ======================= RESULTS =======================
select count(*) filter (where passed) as passed, count(*) filter (where not passed) as failed, count(*) as total from t_results;
select n, label, detail from t_results where not passed order by n;      -- empty = everything passed
select n, case when passed then 'PASS' else 'FAIL' end as result, label from t_results order by n;
rollback;
"""
tokens = sorted(set(re.findall(r"@([A-Z0-9]+)@", text)))
ids = {t: str(uuid.uuid5(uuid.NAMESPACE_DNS, "cgl-command-test-" + t)) for t in tokens}
for t, u in ids.items(): text = text.replace(f"@{t}@", u)
assert not re.findall(r"@[A-Z0-9]+@", text)
pathlib.Path("phase7_all.sql").write_text(text)
print(f"built phase7_all.sql: {len(tokens)} tokens, {text.count('check_(')} check_ calls")
PY
