#!/usr/bin/env python3
"""Match supplier sample CSVs against project Galaxus GTIN index."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from run_poc import DATA, FIELDS, SUPPLIERS, load_index, match_all, read_csv, write_csv  # noqa: E402


def main() -> int:
    samples = {s: read_csv(DATA / f"{s}_sample.csv") for s in SUPPLIERS}
    index = load_index(DATA / "galaxus_gtin_index.csv")
    overlap = match_all(index, samples)
    fields = [
        "supplier", "supplier_sku", "product_url", "name", "brand", "mpn", "gtin", "gtin_valid", "gtin_reason",
        "packaging", "price", "currency", "stock", "match_status", "galaxus_source", "galaxus_title",
        "galaxus_brand", "galaxus_sell_price_chf", "units_sold", "revenue_chf", "last_sale", "our_offer", "notes",
    ]
    write_csv(DATA / "galaxus_overlap.csv", fields, overlap)
    print(f"wrote {len(overlap)} overlap rows → {DATA / 'galaxus_overlap.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
