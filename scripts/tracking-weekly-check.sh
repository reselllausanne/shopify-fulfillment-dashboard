#!/usr/bin/env bash
# Friday tracking digeste — coverage + pixel/server split + funnel head.
# Usage: bash scripts/tracking-weekly-check.sh
# Optional:
#   TRACKING_WEEKLY_OUT=tmp_tracking/weekly-YYYY-MM-DD.txt
#   TRACKING_WEEKLY_MAILTO=ops@example.com   # sends via `mail` if present
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WEEK="$(date +%Y-%m-%d)"
OUT="${TRACKING_WEEKLY_OUT:-tmp_tracking/weekly-${WEEK}.txt}"
mkdir -p "$(dirname "$OUT")"

SHADOW_JSON="$(mktemp)"
trap 'rm -f "$SHADOW_JSON"' EXIT

npx tsx scripts/tracking-shadow-report.ts --days=7 --json >"$SHADOW_JSON"

{
  echo "=== Tracking weekly digeste ${WEEK} ==="
  echo "Targets: coverage ≥90% (7d), 0 duplicate checkout_completed, top funnel drop"
  echo "Do NOT: Ads Primary / Simprosys cutover. G4 Secondary only after APPROVED_AT + action check."
  echo "Dual-CTA WeTheNew: live (panel_checkout + panel_cart)."
  echo
  echo "--- shadow 7d (summary) ---"
  node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const cs = s.coverageSources || {};
    console.log(`orders=${s.shopifyOrders} tracked=${s.trackedOrders} (${s.coveragePct ?? "-"}%) dupes=${s.duplicateCompletions}`);
    console.log(`pixel=${cs.pixel ?? "?"} (${cs.pixelPct ?? "-"}%)  server.orders_paid=${cs.serverOrdersPaid ?? "?"} (${cs.serverOrdersPaidPct ?? "-"}%)  server-only=${cs.serverOnly ?? "?"} (${cs.serverOnlyPct ?? "-"}%)`);
    console.log("consent/click:", s.trackedWithMarketingConsentPct, s.clickIdShareAmongConsented);
    console.log("utm:", s.sourceOfTrackedOrders);
    console.log("A/B:", s.abTrackedOrders);
    console.log("CM2 complete%:", s.internalProfit?.ordersWithCompleteCostPct, "avgCm2:", s.internalProfit?.avgCm2);
    console.log("day         orders tracked cov%   pixel server srvOnly");
    for (const d of s.byDay || []) {
      console.log(
        `${d.day}  ${String(d.orders).padStart(6)} ${String(d.tracked).padStart(7)} ${String(d.coveragePct ?? "-").padStart(5)}%  ${String(d.pixel ?? 0).padStart(5)} ${String(d.server ?? 0).padStart(6)} ${String(d.serverOnly ?? 0).padStart(7)}`
      );
    }
    if ((s.untrackedSample || []).length) {
      console.log("untracked sample:", s.untrackedSample.map((o) => o.name).join(", "));
    }
  ' "$SHADOW_JSON"
  echo
  echo "--- funnel 7d (head) ---"
  npx tsx scripts/funnel-report.ts --days=7 2>&1 | head -40
  echo
  echo "=== checklist ==="
  echo "[ ] coverage ≥ 90% ?"
  echo "[ ] duplicate completions = 0 ?"
  echo "[ ] note pixel vs server-only share (webhook healthy if server-only > 0 but total high)"
  echo "[ ] note top drop (pv→size mobile expected)"
  echo "[ ] GA4 TEST realtime sanity (optional)"
  echo "[ ] G4: Secondary action created + env APPROVED_AT? if yes → dry-run tracking-upload-secondary"
} | tee "$OUT"

echo
echo "Wrote $OUT"

if [[ -n "${TRACKING_WEEKLY_MAILTO:-}" ]] && command -v mail >/dev/null 2>&1; then
  mail -s "Tracking weekly digeste ${WEEK}" "$TRACKING_WEEKLY_MAILTO" <"$OUT"
  echo "Mailed to $TRACKING_WEEKLY_MAILTO"
fi
