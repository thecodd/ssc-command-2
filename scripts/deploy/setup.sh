#!/usr/bin/env bash
# One-shot setup, run on YOUR machine: creates the Supabase project, applies migrations 001..014,
# then deploys to Vercel. Secrets are typed into the CLIs' own prompts / browser logins, never into chat.
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v node >/dev/null || { echo "Install Node 22 first: https://nodejs.org"; exit 1; }
SB="npx --yes supabase@latest"
VC="npx --yes vercel@latest"

echo "== 1/6 Supabase login (opens browser) =="
$SB login

echo "== 2/6 Create project =="
ORG_ID=$($SB orgs list -o json | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(o[0].id)')
read -r -s -p "Choose a database password (not shown, save it): " DBPASS; echo
NAME="${PROJECT_NAME:-cgl-command}"
$SB projects create "$NAME" --org-id "$ORG_ID" --db-password "$DBPASS" --region "${REGION:-ap-south-1}" -o json > .sb-project.json
REF=$(node -p 'require("./.sb-project.json").id')
rm -f .sb-project.json
echo "Project ref: $REF (waiting for it to become healthy...)"
for i in $(seq 1 40); do
  S=$($SB projects list -o json | node -e 'const r=process.argv[1];const p=JSON.parse(require("fs").readFileSync(0,"utf8")).find(x=>x.id===r);console.log(p?p.status:"")' "$REF")
  [ "$S" = "ACTIVE_HEALTHY" ] && break; sleep 10
done

echo "== 3/6 Apply migrations 001..014 =="
rm -rf supabase/migrations && mkdir -p supabase/migrations
i=0; for f in database/migrations/*.sql; do b=$(basename "$f" .sql); cp "$f" "supabase/migrations/2026010100$(printf %04d $i)_${b#*_}.sql"; i=$((i+1)); done
[ -f supabase/config.toml ] || $SB init >/dev/null
$SB link --project-ref "$REF" -p "$DBPASS"
$SB db push -p "$DBPASS" --yes

echo "== 4/6 Read public keys =="
URL="https://$REF.supabase.co"
ANON=$($SB projects api-keys --project-ref "$REF" -o json | node -e 'const k=JSON.parse(require("fs").readFileSync(0,"utf8")).find(x=>x.name==="anon");console.log(k.api_key)')

echo "== 5/6 Vercel deploy (login opens browser) =="
$VC login
$VC link --yes
printf %s "$URL" | $VC env add NEXT_PUBLIC_SUPABASE_URL production
printf %s "$ANON" | $VC env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
PROD=$($VC deploy --prod --yes | tail -1)

echo "== 6/6 Health check =="
curl -fsS "$PROD/api/health" && echo
echo
echo "DONE. App: $PROD   Supabase: $URL"
echo "Next: in Supabase Auth > URL configuration set Site URL = $PROD, sign up in the app, then tell Claude your email."
