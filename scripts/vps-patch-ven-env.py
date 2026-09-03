#!/usr/bin/env python3
"""Patch /opt/resell/.env for Venova (VEN) Shopware 5 scraper — include in cron."""
from __future__ import annotations

import re
from pathlib import Path

path = Path("/opt/resell/.env")
text = path.read_text()
ven_entry = "VEN|Venova|https://www.venova.ch/de|CHF|ven"
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
if not re.search(r"(^|,)\s*VEN\|", raw, re.I):
    new_raw = raw.rstrip(",") + "," + ven_entry
    text, _ = upsert_line("SCRAPER_SHOPS", new_raw, text)
    changed = True
    print("added VEN to SCRAPER_SHOPS")
else:
    print("VEN already in SCRAPER_SHOPS")

# Auto-update: ensure ven is NOT in SCRAPER_CRON_SKIP
m2 = re.search(r"^SCRAPER_CRON_SKIP=(.*)$", text, re.M)
skip = set()
if m2:
    skip = {s.strip().lower() for s in re.split(r"[\s,]+", m2.group(1)) if s.strip()}
if "ven" in skip:
    skip.discard("ven")
    text, ch2 = upsert_line("SCRAPER_CRON_SKIP", ",".join(sorted(skip)) if skip else "", text)
    # empty skip line is awkward — keep at least empty string handled
    if not skip:
        text, ch2 = upsert_line("SCRAPER_CRON_SKIP", "rei,fan,exl,bwz,wrk", text)
        skip = {"rei", "fan", "exl", "bwz", "wrk"}
    changed = changed or ch2
    print("removed ven from SCRAPER_CRON_SKIP")
else:
    print("ven not in SCRAPER_CRON_SKIP (cron enabled)")
print("SCRAPER_CRON_SKIP=", ",".join(sorted(skip)) if skip else "(empty)")

defaults = {
    "SCRAPER_VEN_DEFER_IMAGE_SYNC": "1",
    "SCRAPER_VEN_REQUEST_DELAY_MS": "120",
    "SCRAPER_VEN_CONCURRENCY": "6",
    "SCRAPER_VEN_MARGIN_PERCENT": "20",
    "SCRAPER_VEN_SHIPPING_CHF": "10",
    "SCRAPER_VEN_REQUIRE_EXACT_QTY": "1",
    "SCRAPER_VEN_SKIP_OVER_30KG": "0",
}
for k, v in defaults.items():
    if re.search(rf"^{k}=", text, re.M):
        continue
    text = text.rstrip() + f"\n{k}={v}\n"
    changed = True
    print(f"set default {k}={v}")

if changed:
    Path("/opt/resell/.env.bak.ven").write_text(path.read_text())
    path.write_text(text)
    print("wrote .env (+ backup .env.bak.ven)")
else:
    print("env unchanged")

raw = re.search(r"^SCRAPER_SHOPS=(.*)$", Path("/opt/resell/.env").read_text(), re.M).group(1)
print("shops:", [p.split("|")[0] for p in re.split(r"[\n,]+", raw) if p.strip()])
