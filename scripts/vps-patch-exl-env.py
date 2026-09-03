#!/usr/bin/env python3
"""Patch /opt/resell/.env for Ex Libris scraper (EXL platform, gated from Galaxus feed)."""
from __future__ import annotations

import re
from pathlib import Path

path = Path("/opt/resell/.env")
text = path.read_text()
changed = False
exl_entry = "EXL|Ex Libris|https://www.exlibris.ch|CHF|exl"


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
if not re.search(r"(^|,)\s*EXL\|", raw, re.I):
    new_raw = raw.rstrip(",") + "," + exl_entry
    text, ch = upsert_line("SCRAPER_SHOPS", new_raw, text)
    changed = changed or ch
    print("added EXL to SCRAPER_SHOPS")
else:
    print("EXL already in SCRAPER_SHOPS")

m2 = re.search(r"^SCRAPER_CRON_SKIP=(.*)$", text, re.M)
skip = set()
if m2:
    skip = {s.strip().lower() for s in re.split(r"[\s,]+", m2.group(1)) if s.strip()}
skip.update({"rei", "fan", "exl"})
text, ch2 = upsert_line("SCRAPER_CRON_SKIP", ",".join(sorted(skip)), text)
changed = changed or ch2
print("SCRAPER_CRON_SKIP=", ",".join(sorted(skip)))

defaults = {
    "SCRAPER_EXL_MARGIN_PERCENT": "30",
    "SCRAPER_EXL_MIN_ABS_MARGIN_CHF": "3",
    "SCRAPER_EXL_FREE_SHIP_MIN_CHF": "9.90",
    "SCRAPER_EXL_SMALL_ORDER_FEE_CHF": "5",
    "SCRAPER_EXL_DEFAULT_STOCK": "5",
    "SCRAPER_EXL_DEFER_IMAGE_SYNC": "1",
    "SCRAPER_EXL_REQUEST_DELAY_MS": "400",
    "SCRAPER_EXL_RESUME": "1",
    "EXLIBRIS_CATALOG": "spiele",
    "EXLIBRIS_DELAY": "0.4",
    "EXLIBRIS_LIMIT": "0",
    "EXLIBRIS_FLUSH_EVERY": "100",
    "EXLIBRIS_IMPORT_INTERVAL_SEC": "90",
}
for k, v in defaults.items():
    if re.search(rf"^{k}=", text, re.M):
        continue
    text = text.rstrip() + f"\n{k}={v}\n"
    changed = True
    print(f"set default {k}={v}")

allow = re.search(r"^GALAXUS_FEED_SUPPLIER_ALLOWLIST=(.*)$", text, re.M)
if allow and re.search(r"(^|,)\s*exl\s*(,|$)", allow.group(1), re.I):
    print("WARNING: exl already in GALAXUS_FEED_SUPPLIER_ALLOWLIST (feed gate open)")
else:
    print("Galaxus gate: closed for exl — append exl to GALAXUS_FEED_SUPPLIER_ALLOWLIST when ready")

if changed:
    Path("/opt/resell/.env.bak.exl").write_text(path.read_text())
    path.write_text(text)
    print("wrote .env (+ backup .env.bak.exl)")
else:
    print("env unchanged")
