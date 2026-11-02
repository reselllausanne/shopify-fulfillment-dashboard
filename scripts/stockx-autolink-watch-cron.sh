#!/usr/bin/env bash
#
# Watch hourly stockx-awb-cron autoLink step. If the last 2 completed runs both
# failed or timed out, email STOCKX_ALERT_EMAIL once (via autolinkFailAlert API).
#
# Suggested VPS crontab (after :35 hourly AWB — e.g. :50 Zurich):
#   CRON_TZ=Europe/Zurich
#   50 * * * * /opt/resell/scripts/stockx-autolink-watch-cron.sh >> /var/log/resell/stockx-autolink-watch.log 2>&1
#
set -euo pipefail

BASE_URL="${STOCKX_AWB_BASE_URL:-http://127.0.0.1:3000}"
LOG_DIR="${STOCKX_AWB_LOG_DIR:-/var/log/resell}"
mkdir -p "$LOG_DIR"
AWB_LOG="$LOG_DIR/stockx-awb-sync.log"
WATCH_LOG="$LOG_DIR/stockx-autolink-watch.log"
STATE_FILE="$LOG_DIR/stockx-autolink-watch.state"
BODY_FILE="/tmp/stockx-autolink-watch-body.json"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] START autolink-watch" | tee -a "$WATCH_LOG"

if [[ ! -f "$AWB_LOG" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] SKIP no awb log at $AWB_LOG" | tee -a "$WATCH_LOG"
  exit 0
fi

# Parse last 2 "autolink http=… curl=…" lines from the shared AWB log.
EVAL=$(python3 - "$AWB_LOG" "$STATE_FILE" <<'PY'
import json, re, sys, os
from datetime import datetime, timezone

awb_log, state_path = sys.argv[1], sys.argv[2]
pat = re.compile(
    r"^\[(?P<ts>[^\]]+)\] autolink http=(?P<http>\S+) curl=(?P<curl>\S+)"
)
rows = []
try:
    with open(awb_log, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            m = pat.search(line)
            if not m:
                continue
            rows.append({
                "ts": m.group("ts"),
                "http": m.group("http"),
                "curl": m.group("curl"),
                "line": line.strip()[:240],
            })
except FileNotFoundError:
    print(json.dumps({"action": "skip", "reason": "no_log"}))
    raise SystemExit(0)

if len(rows) < 2:
    print(json.dumps({"action": "skip", "reason": "need_2_samples", "n": len(rows)}))
    raise SystemExit(0)

last2 = rows[-2:]

def failed(r):
    try:
        curl_i = int(r["curl"])
    except Exception:
        curl_i = 1
    return curl_i != 0 or r["http"] != "200"

fails = [failed(r) for r in last2]
if not all(fails):
    # Recovered — clear streak stamp so next double-fail can alert again.
    try:
        if os.path.exists(state_path):
            os.remove(state_path)
    except OSError:
        pass
    print(json.dumps({
        "action": "ok",
        "fails": fails,
        "samples": last2,
    }))
    raise SystemExit(0)

fingerprint = "|".join(f'{r["ts"]}|http={r["http"]}|curl={r["curl"]}' for r in last2)
prev = ""
try:
    with open(state_path, "r", encoding="utf-8") as sf:
        prev = (json.load(sf) or {}).get("fingerprint") or ""
except Exception:
    prev = ""

if prev == fingerprint:
    print(json.dumps({"action": "skip", "reason": "already_alerted", "fingerprint": fingerprint}))
    raise SystemExit(0)

detail_lines = [
    "autoLink failed or timed out on the last 2 hourly cron runs:",
    *(f"- [{r['ts']}] http={r['http']} curl={r['curl']}" for r in last2),
    "",
    "Raw:",
    *(r["line"] for r in last2),
]
print(json.dumps({
    "action": "alert",
    "fingerprint": fingerprint,
    "detail": "\n".join(detail_lines),
    "samples": last2,
}))
PY
)

ACTION=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("action",""))' <<<"$EVAL")
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] eval action=$ACTION ${EVAL:0:500}" | tee -a "$WATCH_LOG"

if [[ "$ACTION" != "alert" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE exit=0 ($ACTION)" | tee -a "$WATCH_LOG"
  exit 0
fi

DETAIL=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("detail",""))' <<<"$EVAL")
FINGERPRINT=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("fingerprint",""))' <<<"$EVAL")

: >"$BODY_FILE"
# JSON-encode detail safely
PAYLOAD=$(DETAIL="$DETAIL" python3 - <<'PY'
import json, os
print(json.dumps({
  "autolinkFailAlert": True,
  "detail": os.environ.get("DETAIL", "")[:4000],
}))
PY
)

set +e
HTTP=$(curl -sS -o "$BODY_FILE" -w "%{http_code}" \
  -X POST "$BASE_URL/api/admin/stockx-awb-sync" \
  -H "content-type: application/json" \
  -d "$PAYLOAD" \
  --max-time 60)
CURL_STATUS=$?
set -e

RESP="$(cat "$BODY_FILE" 2>/dev/null || true)"
EMAILED=$(python3 -c 'import json,sys
try:
  print(json.load(open(sys.argv[1])).get("emailed"))
except Exception:
  print("?")
' "$BODY_FILE" 2>/dev/null || echo "?")

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] alert http=$HTTP curl=$CURL_STATUS emailed=$EMAILED resp=${RESP:0:300}" | tee -a "$WATCH_LOG"

if [[ "$CURL_STATUS" -ne 0 || "$HTTP" != "200" ]]; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE exit=1 (alert post failed)" | tee -a "$WATCH_LOG"
  exit 1
fi

# Stamp only after successful API response (retry next hour if Postmark path failed silently).
python3 - "$STATE_FILE" "$FINGERPRINT" "$EMAILED" <<'PY'
import json,sys
from datetime import datetime, timezone
path, fp, emailed = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "w", encoding="utf-8") as f:
  json.dump({
    "fingerprint": fp,
    "emailed": emailed,
    "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  }, f)
  f.write("\n")
PY

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DONE exit=0 alert stamped emailed=$EMAILED" | tee -a "$WATCH_LOG"
exit 0
