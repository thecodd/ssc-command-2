#!/usr/bin/env bash
# Read-only check of what is installed on THIS machine. Changes nothing, creates nothing.
ok=1
for c in node npm git; do
  if command -v $c >/dev/null; then echo "OK       $c  $($c --version | head -1)"; else echo "MISSING  $c"; ok=0; fi
done
if command -v node >/dev/null; then
  major=$(node -p 'process.versions.node.split(".")[0]'); [ "$major" -ge 22 ] && echo "OK       Node is version 22 or newer" || { echo "TOO OLD  Node must be 22 or newer (you have $major)"; ok=0; }
fi
for c in supabase vercel claude; do command -v $c >/dev/null && echo "OK       $c" || echo "not installed: $c (fine - setup.sh runs supabase and vercel through npx, no install needed)"; done
[ -f .env.local ] && echo "OK       .env.local exists" || echo "note     .env.local missing (needed only for running the app locally)"
[ $ok = 1 ] && echo "READY: you can continue." || echo "NOT READY: install the MISSING items above first (Node 22: https://nodejs.org)."
