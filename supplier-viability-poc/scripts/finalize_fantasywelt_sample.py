#!/usr/bin/env python3
"""Convert FantasyWelt browser probe JSON → products CSV."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.gtin import classify_gtin  # noqa: E402
from lib.schema import empty_product, write_products_csv  # noqa: E402


def row_from_probe(item: dict) -> dict:
    avail_href = item.get("avail") or ""
    availability = ""
    stock = ""
    if "InStock" in avail_href:
        availability = "InStock"
    elif "PreOrder" in avail_href:
        availability = "PreOrder"
    elif "OutOfStock" in avail_href or "SoldOut" in avail_href:
        availability = "OutOfStock"
        stock = "out_of_stock"

    lead = ""
    stock_label = item.get("stockLabel") or ""
    if item.get("lead"):
        m = re.search(r"(\d+)\s*[-–]\s*(\d+)", item["lead"])
        if m:
            lead = f"{m.group(1)}-{m.group(2)}"
    m_from = re.search(r"lieferbar ab\s+(\d{1,2}\.\d{1,2}\.\d{2,4})", stock_label, re.I)
    if m_from:
        lead = lead or f"from_{m_from.group(1)}"
        availability = availability or "PreOrder"

    sku = item.get("sku") or ""
    cls = classify_gtin(item.get("ean"), mpn=sku or None)

    return empty_product(
        "fantasywelt",
        product_url=item["url"],
        supplier_sku=sku,
        name=item.get("name") or "",
        brand=item.get("brand") or "",
        mpn=sku,
        gtin=cls["gtin"] or "",
        gtin_valid="1" if cls["valid"] else "0",
        gtin_reason=cls["reason"],
        price=item.get("price") or "",
        currency="EUR",
        price_basis="gross",
        vat_rate="0.19",
        stock=stock,
        availability=availability,
        lead_time_days=lead,
        origin_country="DE",
        image_url=item.get("img") or "",
        sample_bucket=item.get("sample_bucket") or "probe",
    )


def main() -> None:
    probe = ROOT / "_raw/fantasywelt/sample_probe.json"
    out = ROOT / "data/fantasywelt_sample.csv"
    items = json.loads(probe.read_text(encoding="utf-8"))
    rows = [row_from_probe(i) for i in items]
    n = write_products_csv(out, rows)
    valid = sum(1 for r in rows if r["gtin_valid"] == "1")
    print(f"wrote {n} rows → {out}")
    print(f"gtin_valid={valid}/{n} price={sum(1 for r in rows if r['price'])}/{n}")


if __name__ == "__main__":
    main()
