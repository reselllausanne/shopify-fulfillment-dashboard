"""Shared product CSV schema."""

from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Zurich")

PRODUCT_FIELDS = [
    "supplier",
    "product_url",
    "supplier_sku",
    "name",
    "brand",
    "mpn",
    "gtin",
    "gtin_qty",
    "sales_unit",
    "packaging",
    "price",
    "currency",
    "price_basis",
    "vat_rate",
    "price_tiers",
    "moq",
    "stock",
    "availability",
    "lead_time_days",
    "weight_kg",
    "origin_country",
    "hs_code",
    "image_url",
    "scrape_timestamp",
    "gtin_valid",
    "gtin_reason",
    "parse_error",
    "sample_bucket",
]


def now_zurich_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def empty_product(supplier: str, **kwargs: Any) -> dict:
    row = {k: "" for k in PRODUCT_FIELDS}
    row["supplier"] = supplier
    row["scrape_timestamp"] = now_zurich_iso()
    aliases = {
        "url": "product_url",
        "sample_bucket": "sample_bucket",
        "image_url": "image_url",
        "parse_error": "parse_error",
        "vat_rate": "vat_rate",
        "price_basis": "price_basis",
    }
    for k, v in kwargs.items():
        key = aliases.get(k, k)
        if key in row and v is not None:
            row[key] = v
    return row


def write_products_csv(path: Path, rows: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = list(rows)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PRODUCT_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in PRODUCT_FIELDS})
    return len(rows)


def read_products_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))
