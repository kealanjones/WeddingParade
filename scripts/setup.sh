#!/usr/bin/env bash
# One-off setup: create the Supabase project, apply the schema, write
# site/config.js, create the Netlify site and deploy it.
#
#   ./scripts/setup.sh
#
# Needs Node (for npx). Logs you in to Supabase and Netlify if needed,
# or uses SUPABASE_ACCESS_TOKEN / NETLIFY_AUTH_TOKEN when they are set.
# Safe to re-run: it reuses an existing project/site with the same name.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${PARADE_NAME:-sop-and-bop-balloons}"
REGION="${SUPABASE_REGION:-eu-west-2}" # London
SUPA="npx --yes supabase@latest"
NETLIFY="npx --yes netlify-cli@latest"

need_json() { command -v node >/dev/null || { echo "Please install Node.js first"; exit 1; }; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s);console.log(eval(process.argv[1]))})" "$1"; }
need_json

echo "== Supabase"
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then $SUPA login; fi

REF=$($SUPA projects list -o json | json "(v.find(p=>p.name==='$NAME')||{}).id||(v.find(p=>p.name==='$NAME')||{}).ref||''")
if [ -z "$REF" ]; then
  ORG=$($SUPA orgs list -o json | json "v[0].id")
  DB_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")
  echo "Creating project $NAME in $REGION (org $ORG)…"
  $SUPA projects create "$NAME" --org-id "$ORG" --region "$REGION" --db-password "$DB_PASSWORD" -o json >/dev/null
  REF=$($SUPA projects list -o json | json "(v.find(p=>p.name==='$NAME')||{}).id||(v.find(p=>p.name==='$NAME')||{}).ref")
  echo "Database password (keep it somewhere safe): $DB_PASSWORD"
  echo "Waiting for the project to come up…"
  sleep 60
fi
echo "Project ref: $REF"

echo "Applying schema…"
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  # Over HTTPS via the Management API (works where database ports are blocked).
  for f in supabase/migrations/*.sql; do
    for attempt in 1 2 3 4 5 6; do
      if node -e "
        const sql=require('fs').readFileSync(process.argv[1],'utf8');
        fetch('https://api.supabase.com/v1/projects/$REF/database/query',{method:'POST',
          headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},
          body:JSON.stringify({query:sql})}).then(async r=>{const t=await r.text();if(!r.ok){console.error(r.status,t);process.exit(1)}})
      " "$f"; then break; fi
      echo "  not ready yet, retrying in 20s"; sleep 20
    done
  done
else
  $SUPA link --project-ref "$REF"
  $SUPA db push
fi

ANON=$($SUPA projects api-keys --project-ref "$REF" -o json | json "(v.find(k=>k.name==='anon')||v.find(k=>/publishable/.test(k.name||k.type))).api_key")
node -e "
  const fs=require('fs');const p='site/config.js';let s=fs.readFileSync(p,'utf8');
  s=s.replace(/supabaseUrl: \".*?\"/,'supabaseUrl: \"https://$REF.supabase.co\"').replace(/supabaseAnonKey: \".*?\"/,'supabaseAnonKey: \"'+process.argv[1]+'\"');
  fs.writeFileSync(p,s)" "$ANON"
echo "Wrote site/config.js"

echo "== Netlify"
if [ -z "${NETLIFY_AUTH_TOKEN:-}" ]; then $NETLIFY login; fi
if [ ! -f .netlify/state.json ]; then
  $NETLIFY sites:create --name "$NAME" --disable-linking >/dev/null 2>&1 || true
  $NETLIFY link --name "$NAME"
fi
$NETLIFY deploy --prod --dir site --message "setup"
echo
echo "Done. Guests:  https://$NAME.netlify.app/"
echo "      Parade:  https://$NAME.netlify.app/parade.html"
