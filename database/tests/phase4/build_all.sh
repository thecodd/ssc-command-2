#!/usr/bin/env bash
# Builds ONE runnable script: database/tests/phase4/phase4_all.sql
#   1. substitutes @TOKEN@ placeholders with fixed UUIDs (same token => same UUID)
#   2. inlines the generated reference vectors (no psql \ir needed, so it also works in the Supabase SQL editor)
#   3. appends the result table and ROLLBACK
# Usage: bash database/tests/phase4/build_all.sh      then run phase4_all.sql on a SCRATCH Supabase project after migrations 001-011.
set -euo pipefail
cd "$(dirname "$0")"
[ -f ../reference/generated_vectors.sql ] || node ../reference/run_reference_tests.js
python3 - <<'PY'
import re, uuid, pathlib
parts = ["00_harness.sql","05_integrity.sql","06_registry.sql","07_progress_sessions.sql","08_revision.sql","09_pyq.sql","10_signals.sql","11_publishing_import.sql"]
text = "\n".join(pathlib.Path(p).read_text() for p in parts)
vec = pathlib.Path("../reference/generated_vectors.sql").read_text()
text = text.replace("\\ir ../reference/generated_vectors.sql", vec)
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
left = re.findall(r"@[A-Z0-9]+@", text)
assert not left, left
pathlib.Path("phase4_all.sql").write_text(text)
print(f"built phase4_all.sql: {len(tokens)} tokens, {text.count('check_(')} check_ calls, {len(text.splitlines())} lines")
PY
