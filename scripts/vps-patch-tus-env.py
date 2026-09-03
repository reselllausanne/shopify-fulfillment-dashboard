#!/usr/bin/env python3
"""Patch /opt/resell/.env for The Uncommon Shop (TUS) WooCommerce scraper."""
from __future__ import annotations

import re
from pathlib import Path

path = Path("/opt/resell/.env")
text = path.read_text()
tus_entry = "TUS|The Uncommon Shop|https://theuncommonshop.ch|CHF|tus"
changed = False


def upsert_line(key: str, value: str, body: str) -> tuple[str, bool]:
    pat = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    line = f"{key}={value}"
    if pat.search(body):
        new = pat.sub(line, body, count=1)
        return new, new != body
    return body.rstrip() + "\n" + line + "\n", True


m = re.search(r"^SCRAPER_SHOPS=(.*)$", text, re.M)
if not m:
    raise SystemExit("SCRAPER_SHOPS missing")
raw = m.group(1).strip().strip("\"'")
if not re.search(r"(^|,)\s*TUS\|", raw, re.I):
    new_raw = raw.rstrip(",") + "," + tus_entry
    text, _ = upsert_line("SCRAPER_SHOPS", new_raw, text)
    changed = True
    print("added TUS to SCRAPER_SHOPS")
else:
    print("TUS already in SCRAPER_SHOPS")

defaults = {
    "SCRAPER_TUS_DEFER_IMAGE_SYNC": "1",
    "SCRAPER_TUS_REQUEST_DELAY_MS": "80",
    "SCRAPER_TUS_CONCURRENCY": "6",
    "SCRAPER_TUS_VARIATION_CONCURRENCY": "8",
    "SCRAPER_TUS_PAGE_SIZE": "50",
    "SCRAPER_TUS_MARGIN_PERCENT": "20",
    "SCRAPER_TUS_SHIPPING_CHF": "7",
    "SCRAPER_TUS_FREE_SHIP_CHF": "79",
    "SCRAPER_TUS_REQUIRE_EXACT_QTY": "1",
    "SCRAPER_TUS_LEAD_TIME_DAYS": "2",
}
for k, v in defaults.items():
    if re.search(rf"^{k}=", text, re.M):
        continue
    text = text.rstrip() + f"\n{k}={v}\n"
    changed = True
    print(f"set default {k}={v}")

# Galaxus feed allowlist
m_allow = re.search(r"^GALAXUS_FEED_SUPPLIER_ALLOWLIST=(.*)$", text, re.M)
if m_allow:
    allow_raw = m_allow.group(1).strip().strip("\"'")
    keys = [k.strip().lower() for k in re.split(r"[\s,]+", allow_raw) if k.strip()]
    if "tus" not in keys:
        keys.append("tus")
        text, _ = upsert_line("GALAXUS_FEED_SUPPLIER_ALLOWLIST", ",".join(keys), text)
        changed = True
        print("added tus to GALAXUS_FEED_SUPPLIER_ALLOWLIST")
    else:
        print("tus already in GALAXUS_FEED_SUPPLIER_ALLOWLIST")
else:
    text, _ = upsert_line("GALAXUS_FEED_SUPPLIER_ALLOWLIST", "tus", text)
    changed = True
    print("created GALAXUS_FEED_SUPPLIER_ALLOWLIST=tus")

if changed:
    Path("/opt/resell/.env.bak.tus").write_text(path.read_text())
    path.write_text(text)
    print("wrote .env (+ backup .env.bak.tus)")
else:
    print("env unchanged")

raw = re.search(r"^SCRAPER_SHOPS=(.*)$", Path("/opt/resell/.env").read_text(), re.M).group(1)
print("shops:", [p.split("|")[0] for p in re.split(r"[\n,]+", raw) if p.strip()])
print("cron: 0 4 */3 * * /opt/resell/scripts/scrape-cron.sh tus >> /opt/resell/scrape-tus-cron.log 2>&1")
