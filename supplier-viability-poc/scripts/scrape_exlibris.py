#!/usr/bin/env python3
"""Long-running Ex Libris scraper — checkpoint/resume for multi-hour/day crawls.

Listing pages yield EAN, CHF price, availability text, image (~24 products/request).
Optional PDP hydration adds brand/label and richer availability.

Examples:
  # Toys/games catalog, resume overnight (~94k SKUs; 1 req/s ≈ 1 day for listings only)
  python3 scripts/scrape_exlibris.py --catalog spiele --limit 0 --resume

  # Sample 500 with brand from PDPs
  python3 scripts/scrape_exlibris.py --catalog spiele --limit 500 --hydrate-pdp

  # Music CDs
  python3 scripts/scrape_exlibris.py --catalog musik_cd --limit 5000 --resume
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.scrape_exlibris_runner import (  # noqa: E402
    ExlibrisScraper,
    default_catalogs_for_name,
)
from lib.schema import write_products_csv  # noqa: E402
from run_poc import FetchError, Session, get_html  # noqa: E402

TZ = ZoneInfo("Europe/Zurich")
DATA = ROOT / "data"


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def make_fetch(session: Session, delay: float):
    def fetch(url: str) -> str:
        try:
            return get_html(session, url)
        except FetchError as e:
            raise RuntimeError(str(e)) from e
        finally:
            if delay > 0:
                time.sleep(max(0.0, delay - session.delay))

    return fetch


def main() -> int:
    ap = argparse.ArgumentParser(description="Scrape Ex Libris (DE paths, robots-aware).")
    ap.add_argument(
        "--catalog",
        default="spiele",
        help=f"Catalog key or alias (spiele, musik_cd, musik_vinyl, games, toys, media, all). "
        f"Keys: {', '.join(default_catalogs_for_name('all'))}",
    )
    ap.add_argument("--limit", type=int, default=0, help="Max products (0 = unlimited)")
    ap.add_argument("--delay", type=float, default=1.0, help="Seconds between requests")
    ap.add_argument("--hydrate-pdp", action="store_true", help="Fetch PDP for every product")
    ap.add_argument(
        "--hydrate-every",
        type=int,
        default=0,
        help="Fetch PDP every N products (0 = off unless --hydrate-pdp)",
    )
    ap.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    ap.add_argument("--flush-every", type=int, default=100, help="Rewrite CSV every N products")
    ap.add_argument(
        "--checkpoint",
        type=Path,
        default=DATA / "exlibris_checkpoint.json",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=DATA / "exlibris_products.csv",
    )
    ap.add_argument("--meta-out", type=Path, default=DATA / "exlibris_scrape_meta.json")
    args = ap.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)
    catalogs = default_catalogs_for_name(args.catalog)
    session = Session(args.delay)
    fetch = make_fetch(session, 0)

    all_rows: list[dict] = []
    metas: list[dict] = []

    def log_progress(info: dict) -> None:
        print(
            f"[{now_iso()}] cat={info.get('category','?')} page={info.get('page')} "
            f"+{info.get('new_on_page',0)} total={info.get('total')} req={info.get('requests')}",
            flush=True,
        )

    for cat in catalogs:
        ckpt = args.checkpoint
        if len(catalogs) > 1:
            ckpt = args.checkpoint.with_name(f"{args.checkpoint.stem}_{cat}{args.checkpoint.suffix}")
        out = args.out
        if len(catalogs) > 1:
            out = args.out.with_name(f"{args.out.stem}_{cat}{args.out.suffix}")

        print(f"=== exlibris catalog={cat} ===", flush=True)
        scraper = ExlibrisScraper(
            fetch,
            catalog=cat,
            delay_s=args.delay,
            hydrate_pdp=args.hydrate_pdp,
            hydrate_every=args.hydrate_every,
            checkpoint_path=ckpt,
            resume=args.resume,
            on_progress=log_progress,
        )
        result = scraper.run(
            limit=args.limit if args.limit > 0 else 0,
            flush_every=args.flush_every,
            out_csv=out,
        )
        all_rows.extend(result.rows)
        metas.append(result.meta)
        print(json.dumps(result.meta, indent=2, ensure_ascii=False), flush=True)

        if args.limit > 0 and len(all_rows) >= args.limit:
            all_rows = all_rows[: args.limit]
            break

    if len(catalogs) > 1:
        write_products_csv(args.out, all_rows)

    meta_doc = {
        "started": now_iso(),
        "catalogs": catalogs,
        "limit": args.limit,
        "total_written": len(all_rows),
        "gtin_valid_n": sum(1 for r in all_rows if r.get("gtin_valid") == "1"),
        "http_stats": dict(session.stats),
        "runs": metas,
        "out": str(args.out),
    }
    args.meta_out.write_text(json.dumps(meta_doc, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {args.out} ({len(all_rows)} rows), meta {args.meta_out}", flush=True)
    print("http_stats", dict(session.stats), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
