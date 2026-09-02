#!/usr/bin/env python3
"""Patch /opt/resell/.env for Baby-Walz (BWZ) Scayle scraper."""
from __future__ import annotations

import re
from pathlib import Path

path = Path("/opt/resell/.env")
text = path.read_text()
bwz_entry = "BWZ|Baby-Walz|https://www.baby-walz.ch/de|CHF|bwz"
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
if not re.search(r"(^|,)\s*BWZ\|", raw, re.I):
    new_raw = raw.rstrip(",") + "," + bwz_entry
    text, _ = upsert_line("SCRAPER_SHOPS", new_raw, text)
    changed = True
    print("added BWZ to SCRAPER_SHOPS")
else:
    print("BWZ already in SCRAPER_SHOPS")

m2 = re.search(r"^SCRAPER_CRON_SKIP=(.*)$", text, re.M)
skip = set()
if m2:
    skip = {s.strip().lower() for s in re.split(r"[\s,]+", m2.group(1)) if s.strip()}
skip.update({"rei", "bwz"})
text, ch2 = upsert_line("SCRAPER_CRON_SKIP", ",".join(sorted(skip)), text)
changed = changed or ch2
print("SCRAPER_CRON_SKIP=", ",".join(sorted(skip)))

defaults = {
    "SCRAPER_BWZ_DEFER_IMAGE_SYNC": "1",
    "SCRAPER_BWZ_REQUEST_DELAY_MS": "120",
    "SCRAPER_BWZ_CONCURRENCY": "4",
    "SCRAPER_BWZ_MIN_PRICE_CHF": "5",
    "SCRAPER_BWZ_SKIP_BULKY": "1",
}
for k, v in defaults.items():
    if re.search(rf"^{k}=", text, re.M):
        continue
    text = text.rstrip() + f"\n{k}={v}\n"
    changed = True
    print(f"set default {k}={v}")

if changed:
    Path("/opt/resell/.env.bak.bwz").write_text(path.read_text())
    path.write_text(text)
    print("wrote .env (+ backup .env.bak.bwz)")
else:
    print("env unchanged")

raw = re.search(r"^SCRAPER_SHOPS=(.*)$", Path("/opt/resell/.env").read_text(), re.M).group(1)
print("shops:", [p.split("|")[0] for p in re.split(r"[\n,]+", raw) if p.strip()])
