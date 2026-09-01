#!/usr/bin/env python3
"""Scrape ~50 Ex Libris Spiele products across categories for Galaxus GTIN cross-check.

Uses category HTML `__NEXT_DATA__` tiles (EAN + CHF price + availability text).
Optionally hydrates brand from a few PDPs. Polite delay; DE paths preferred.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.parse_exlibris import (  # noqa: E402
    BASE,
    SAMPLE_CATEGORIES,
    SPIELE_ROOT,
    category_total,
    extract_product_tiles,
    parse_product_html,
    tile_to_product,
)
from lib.schema import PRODUCT_FIELDS, write_products_csv  # noqa: E402

UA = (
    "Mozilla/5.0 (compatible; SupplierViabilityPOC/1.0; +read-only research; "
    "exlibris sample)"
)


def fetch(url: str, timeout: float = 45.0) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "de-CH,de;q=0.9,fr;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "ignore")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--hydrate-pdp", type=int, default=12, help="PDPs to enrich brand")
    ap.add_argument(
        "--out",
        type=Path,
        default=ROOT / "data" / "exlibris_sample.csv",
    )
    args = ap.parse_args()

    raw_dir = ROOT / "_raw" / "exlibris"
    raw_dir.mkdir(parents=True, exist_ok=True)

    # root total
    print(f"fetch root {SPIELE_ROOT}", flush=True)
    root_html = fetch(BASE + SPIELE_ROOT)
    (raw_dir / "root.html").write_text(root_html, encoding="utf-8")
    total = category_total(root_html)
    print(f"TotalProductsNumber={total}", flush=True)
    time.sleep(args.delay)

    seen: set[str] = set()
    rows: list[dict] = []
    per_cat = max(2, args.limit // max(1, len(SAMPLE_CATEGORIES)))

    for bucket, path in SAMPLE_CATEGORIES:
        if len(rows) >= args.limit:
            break
        url = BASE + path
        print(f"cat {bucket} {path}", flush=True)
        try:
            html = fetch(url)
        except Exception as e:
            print(f"  FAIL {e}", flush=True)
            time.sleep(args.delay)
            continue
        safe = bucket.replace("/", "_")
        (raw_dir / f"cat_{safe}.html").write_text(html, encoding="utf-8")
        tiles = extract_product_tiles(html)
        cat_total = category_total(html)
        print(f"  tiles={len(tiles)} total={cat_total}", flush=True)
        taken = 0
        for tile in tiles:
            if len(rows) >= args.limit or taken >= per_cat + 2:
                break
            ean = tile["ean"]
            if ean in seen:
                continue
            seen.add(ean)
            row = tile_to_product(tile, sample_bucket=bucket)
            rows.append(row)
            taken += 1
        time.sleep(args.delay)

    # fill remainder from root pages 1..n if still short
    page = 1
    while len(rows) < args.limit and page <= 8:
        url = BASE + SPIELE_ROOT + (f"?page={page}" if page > 1 else "")
        print(f"fill page {page}", flush=True)
        try:
            html = fetch(url)
        except Exception as e:
            print(f"  FAIL {e}", flush=True)
            break
        (raw_dir / f"page_{page}.html").write_text(html, encoding="utf-8")
        for tile in extract_product_tiles(html):
            if len(rows) >= args.limit:
                break
            ean = tile["ean"]
            if ean in seen:
                continue
            seen.add(ean)
            rows.append(tile_to_product(tile, sample_bucket=tile.get("genre") or "spiele_root"))
        page += 1
        time.sleep(args.delay)

    # hydrate brand from PDPs (first N)
    hydrated = 0
    for row in rows:
        if hydrated >= args.hydrate_pdp:
            break
        url = row.get("product_url") or ""
        if not url:
            continue
        print(f"pdp {row.get('gtin')}", flush=True)
        try:
            html = fetch(url)
            (raw_dir / f"pdp_{row['gtin']}.html").write_text(html, encoding="utf-8")
            rich = parse_product_html(html, url, sample_bucket=row.get("sample_bucket") or "")
            if rich.get("brand"):
                row["brand"] = rich["brand"]
            if rich.get("availability"):
                row["availability"] = rich["availability"]
            if rich.get("stock"):
                row["stock"] = rich["stock"]
            if rich.get("name"):
                row["name"] = rich["name"]
            if rich.get("image_url") and not row.get("image_url"):
                row["image_url"] = rich["image_url"]
            if rich.get("parse_error"):
                row["parse_error"] = rich["parse_error"]
            hydrated += 1
        except Exception as e:
            row["parse_error"] = f"pdp_fetch:{e}"[:200]
        time.sleep(args.delay)

    n = write_products_csv(args.out, rows)
    meta = {
        "supplier": "exlibris",
        "catalog": "hobby-spiele-brettspiele",
        "catalog_total": total,
        "sample_n": n,
        "categories_hit": sorted({r.get("sample_bucket") for r in rows}),
        "gtin_valid_n": sum(1 for r in rows if r.get("gtin_valid") == "1"),
        "out": str(args.out),
        "notes": [
            "Stock unquantified (availability text/icon only)",
            "EAN in URL /id/{ean}/",
            "CHF gross list/sales from tiles",
            "robots.txt Disallow /fr/ — used DE paths",
        ],
    }
    meta_path = args.out.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    # compact TSV for quick Galaxus paste
    tsv = args.out.with_suffix(".tsv")
    with tsv.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["gtin", "name", "brand", "buy_chf", "sell_chf", "margin_pct", "category", "url", "availability"])
        for r in rows:
            sell = ""
            margin = ""
            try:
                tiers = json.loads(r.get("price_tiers") or "{}")
                sell = tiers.get("sell_chf", "")
                margin = tiers.get("margin_percent", "")
            except json.JSONDecodeError:
                pass
            w.writerow(
                [
                    r.get("gtin"),
                    r.get("name"),
                    r.get("brand"),
                    r.get("price"),
                    sell,
                    margin,
                    r.get("sample_bucket"),
                    r.get("product_url"),
                    r.get("availability"),
                ]
            )

    print(json.dumps(meta, indent=2, ensure_ascii=False))
    print(f"wrote {args.out} + {tsv}")
    print("fields", PRODUCT_FIELDS[:5], "...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
