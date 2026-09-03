"""Finalize scraped rows onto schema + GTIN classification."""

from __future__ import annotations

from lib.gtin import classify_gtin
from lib.schema import empty_product


def finalize_row(row: dict) -> dict:
    base = empty_product(row.get("supplier") or "unknown")
    for k, v in row.items():
        if k in base and v is not None and v != "":
            base[k] = v
    # alias cleanup
    if row.get("parse_error") and not base.get("parse_error"):
        base["parse_error"] = row["parse_error"]
    cls = classify_gtin(
        base.get("gtin"),
        mpn=base.get("mpn") or None,
        packaging_hint=base.get("packaging") or None,
    )
    base["gtin"] = cls["gtin"] or ""
    base["gtin_valid"] = "1" if cls["valid"] and not cls["mpn_collision"] else "0"
    base["gtin_reason"] = cls["reason"]
    if not base.get("gtin_qty"):
        base["gtin_qty"] = "1"
    if not base.get("sales_unit"):
        base["sales_unit"] = "piece"
    return base
