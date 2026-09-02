#!/usr/bin/env python3
"""Patch /opt/resell/.env for Alternate (ALT) scraper + Galaxus allowlist."""
from __future__ import annotations

import re
from pathlib import Path

path = Path("/opt/resell/.env")
text = path.read_text()
alt_entry = "ALT|Alternate|https://www.alternate.ch|CHF|alt"
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
if not re.search(r"(^|,)\s*ALT\|", raw, re.I):
    new_raw = raw.rstrip(",") + "," + alt_entry
    text, _ = upsert_line("SCRAPER_SHOPS", new_raw, text)
    changed = True
    print("added ALT to SCRAPER_SHOPS")
else:
    print("ALT already in SCRAPER_SHOPS")

if not re.search(r"^SCRAPER_PROXY_FILE=", text, re.M):
    text = text.rstrip() + "\nSCRAPER_PROXY_FILE=/app/.data/reichelt-proxies.txt\n"
    changed = True
    print("set SCRAPER_PROXY_FILE=/app/.data/reichelt-proxies.txt")

# Keep heavy adapters off shared cron; ALT can join cron once stable
text, ch2 = upsert_line("SCRAPER_CRON_SKIP", "rei,fan,exl", text)
changed = changed or ch2
print("SCRAPER_CRON_SKIP=rei,fan,exl")

m_allow = re.search(r"^GALAXUS_FEED_SUPPLIER_ALLOWLIST=(.*)$", text, re.M)
if m_allow:
    allow = m_allow.group(1).strip().strip("\"'")
    parts = [p.strip() for p in allow.split(",") if p.strip()]
    lower = {p.lower() for p in parts}
    if "alt" not in lower:
        parts.append("alt")
        text, _ = upsert_line("GALAXUS_FEED_SUPPLIER_ALLOWLIST", ",".join(parts), text)
        changed = True
        print("added alt to GALAXUS_FEED_SUPPLIER_ALLOWLIST")
    else:
        print("alt already in allowlist")
else:
    text, _ = upsert_line("GALAXUS_FEED_SUPPLIER_ALLOWLIST", "alt", text)
    changed = True
    print("created GALAXUS_FEED_SUPPLIER_ALLOWLIST=alt")

defaults = {
    "SCRAPER_ALT_DEFER_IMAGE_SYNC": "1",
    "SCRAPER_ALT_REQUEST_DELAY_MS": "120",
    "SCRAPER_ALT_CONCURRENCY": "6",
    "SCRAPER_ALT_SHIPPING_CHF": "16",
    "SCRAPER_ALT_MARGIN_PERCENT": "20",
    "SCRAPER_ALT_DEFAULT_STOCK": "5",
}
for k, v in defaults.items():
    if re.search(rf"^{k}=", text, re.M):
        continue
    text = text.rstrip() + f"\n{k}={v}\n"
    changed = True
    print(f"set default {k}={v}")

if changed:
    Path("/opt/resell/.env.bak.alt").write_text(path.read_text())
    path.write_text(text)
    print("wrote .env (+ backup .env.bak.alt)")
else:
    print("env unchanged")

raw = re.search(r"^SCRAPER_SHOPS=(.*)$", Path("/opt/resell/.env").read_text(), re.M).group(1)
print("shops:", [p.split("|")[0] for p in re.split(r"[\n,]+", raw) if p.strip()])
allow = re.search(r"^GALAXUS_FEED_SUPPLIER_ALLOWLIST=(.*)$", Path("/opt/resell/.env").read_text(), re.M)
print("allowlist:", allow.group(1) if allow else None)
