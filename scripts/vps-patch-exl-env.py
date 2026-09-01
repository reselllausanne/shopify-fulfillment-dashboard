#!/usr/bin/env python3
"""Patch /opt/resell/.env for Ex Libris day crawl (Python POC, not SCRAPER_SHOPS yet)."""
from __future__ import annotations

import re
from pathlib import Path

path = Path("/opt/resell/.env")
text = path.read_text()
changed = False


def upsert_line(key: str, value: str, body: str) -> tuple[str, bool]:
    pat = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    line = f"{key}={value}"
    if pat.search(body):
        new = pat.sub(line, body, count=1)
        return new, new != body
    return body.rstrip() + "\n" + line + "\n", True


defaults = {
    "SCRAPER_EXL_MARGIN_PERCENT": "30",
    "SCRAPER_EXL_MIN_ABS_MARGIN_CHF": "3",
    "SCRAPER_EXL_FREE_SHIP_MIN_CHF": "9.90",
    "SCRAPER_EXL_SMALL_ORDER_FEE_CHF": "5",
    "EXLIBRIS_CATALOG": "spiele",
    "EXLIBRIS_DELAY": "1.0",
    "EXLIBRIS_LIMIT": "0",
    "EXLIBRIS_FLUSH_EVERY": "100",
}
for k, v in defaults.items():
    if re.search(rf"^{k}=", text, re.M):
        continue
    text = text.rstrip() + f"\n{k}={v}\n"
    changed = True
    print(f"set default {k}={v}")

if changed:
    Path("/opt/resell/.env.bak.exl").write_text(path.read_text())
    path.write_text(text)
    print("wrote .env (+ backup .env.bak.exl)")
else:
    print("env unchanged")
