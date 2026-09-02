#!/usr/bin/env bash
# Trigger configured SCRAPER_SHOPS (Shopify + HHV + Reichelt adapters).
# Intended to be run by cron on the VPS host. Mints a short-lived admin JWT
# from JWT_SECRET (in /opt/resell/.env) and POSTs the scrape endpoint.
#
# Cron examples:
#   All shops except skip-list every 3 days:
#     0 3 */3 * * /opt/resell/scripts/scrape-cron.sh >> /opt/resell/scrape-cron.log 2>&1
#   Reichelt only every 3 days (detached):
#     0 3 */3 * * /opt/resell/scripts/run-reichelt-detached.sh >> /opt/resell/scrape-rei-cron.log 2>&1
#
# Env:
#   SCRAPER_CRON_SKIP=rei,fan   — comma/space keys skipped when no shop arg (default: rei)
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

trigger_shop() {
  local shop="$1"
  local url="$BASE/api/scraper/scrape?shop=${shop}"
  echo "[$(date -Is)] triggering scrape shop=${shop} -> $url"
  curl -fsS -m 120 -X POST -H "Cookie: auth_token=$JWT" "$url"
  echo
}

SHOP="${1:-}"
if [ -n "$SHOP" ]; then
  trigger_shop "$(echo "$SHOP" | tr '[:upper:]' '[:lower:]')"
  exit 0
fi

# No arg: all SCRAPER_SHOPS keys except SCRAPER_CRON_SKIP (default rei).
SKIP_RAW="${SCRAPER_CRON_SKIP:-rei}"
SKIP=$(echo "$SKIP_RAW" | tr '[:upper:]' '[:lower:]' | tr ', ' '\n' | tr -s '\n' | grep -v '^$' || true)
SHOPS_RAW=$(grep -m1 '^SCRAPER_SHOPS=' .env | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//')
KEYS=$(echo "$SHOPS_RAW" | tr ',' '\n' | while IFS= read -r entry; do
  entry=$(echo "$entry" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [ -z "$entry" ] && continue
  key=$(echo "$entry" | cut -d'|' -f1 | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
  [ -n "$key" ] && echo "$key"
done)

triggered=0
for key in $KEYS; do
  if echo "$SKIP" | grep -qx "$key"; then
    echo "[$(date -Is)] skip shop=${key} (SCRAPER_CRON_SKIP)"
    continue
  fi
  trigger_shop "$key"
  triggered=$((triggered + 1))
done

if [ "$triggered" -eq 0 ]; then
  echo "[$(date -Is)] WARNING: no shops triggered (check SCRAPER_SHOPS / SCRAPER_CRON_SKIP)"
  exit 1
fi
