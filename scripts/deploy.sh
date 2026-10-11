#!/usr/bin/env bash
# Redeploy the site to Netlify after editing anything in site/.
set -euo pipefail
cd "$(dirname "$0")/.."
npx --yes netlify-cli@latest deploy --prod --dir site --message "${1:-update}"
