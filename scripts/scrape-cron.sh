#!/usr/bin/env bash
# Trigger the in-app Shopify scraper for all configured SCRAPER_SHOPS.
# Intended to be run by cron on the VPS host. Mints a short-lived admin JWT
# from JWT_SECRET (in /opt/resell/.env) and POSTs the scrape endpoint.
#
# Cron example (daily 03:00):
#   0 3 * * * /opt/resell/scripts/scrape-cron.sh >> /opt/resell/scrape-cron.log 2>&1
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/resell}"
cd "$REPO_DIR"

SECRET=$(grep -m1 '^JWT_SECRET=' .env | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//')
[ -n "$SECRET" ] || { echo "[$(date -Is)] ERROR: JWT_SECRET not found in .env"; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
now=$(date +%s)
exp=$((now + 600))
payload=$(printf '%s' "{\"role\":\"admin\",\"iat\":$now,\"exp\":$exp}" | b64url)
si="$header.$payload"
sig=$(printf '%s' "$si" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)
JWT="$si.$sig"

BASE="${SCRAPER_BASE_URL:-http://localhost:3000}"
echo "[$(date -Is)] triggering scrape (all configured shops) -> $BASE"
curl -fsS -m 120 -X POST -H "Cookie: auth_token=$JWT" "$BASE/api/scraper/scrape"
echo
