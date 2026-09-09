#!/usr/bin/env python3
"""Move EXL/FAN into shared scrape-cron; drop SNL from Galaxus feed."""
from __future__ import annotations

import re
from pathlib import Path

path = Path("/opt/resell/.env")
text = path.read_text()
changed = False

# Keys that stay on detached / dedicated cron (not shared batch).
KEEP_SKIP = {"rei", "bwz", "wrk", "hhv"}


def upsert_line(key: str, value: str, body: str) -> tuple[str, bool]:
    pat = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    line = f"{key}={value}"
    if pat.search(body):
        new = pat.sub(line, body, count=1)
        return new, new != body
    return body.rstrip() + "\n" + line + "\n", True


def parse_csv_line(key: str, body: str) -> list[str]:
    m = re.search(rf"^{re.escape(key)}=(.*)$", body, re.M)
    if not m:
        return []
    raw = m.group(1).strip().strip("\"'")
    return [p.strip() for p in raw.split(",") if p.strip()]


m = re.search(r"^SCRAPER_CRON_SKIP=(.*)$", text, re.M)
skip = set()
if m:
    skip = {s.strip().lower() for s in re.split(r"[\s,]+", m.group(1)) if s.strip()}
skip = KEEP_SKIP
text, ch = upsert_line("SCRAPER_CRON_SKIP", ",".join(sorted(skip)), text)
changed = changed or ch
print("SCRAPER_CRON_SKIP=", ",".join(sorted(skip)))

# Ensure SNL not allowlisted; always blocklisted for now.
allow = parse_csv_line("GALAXUS_FEED_SUPPLIER_ALLOWLIST", text)
allow = [k for k in allow if k.lower() != "snl"]
text, ch2 = upsert_line("GALAXUS_FEED_SUPPLIER_ALLOWLIST", ",".join(allow), text)
changed = changed or ch2

block = {k.lower() for k in parse_csv_line("GALAXUS_FEED_SUPPLIER_BLOCKLIST", text)}
block.add("snl")
text, ch3 = upsert_line("GALAXUS_FEED_SUPPLIER_BLOCKLIST", ",".join(sorted(block)), text)
changed = changed or ch3

# Drop SNL from SCRAPER_SHOPS if present.
mshops = re.search(r"^SCRAPER_SHOPS=(.*)$", text, re.M)
if mshops:
    raw = mshops.group(1).strip().strip("\"'")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    kept = [p for p in parts if not re.match(r"^SNL\|", p, re.I)]
    if len(kept) != len(parts):
        text, ch4 = upsert_line("SCRAPER_SHOPS", ",".join(kept), text)
        changed = changed or ch4
        print("removed SNL from SCRAPER_SHOPS")

if changed:
    Path("/opt/resell/.env.bak.scraper-cron-shared").write_text(path.read_text())
    path.write_text(text)
    print("wrote .env (+ backup .env.bak.scraper-cron-shared)")
else:
    print("env unchanged")
