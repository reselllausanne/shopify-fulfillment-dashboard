#!/usr/bin/env python3
"""CLI wrapper — scrape one or all suppliers (delegates to run_poc)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from run_poc import (  # noqa: E402
    DATA,
    Session,
    scrape_berrybase,
    scrape_buerklin,
    scrape_exlibris,
    scrape_farnell,
    scrape_pollin,
    write_csv,
    FIELDS,
)


def main() -> int:
    ap = argparse.ArgumentParser(description="Scrape supplier product samples (robots-aware, 1 rps).")
    ap.add_argument(
        "--supplier",
        choices=["farnell", "buerklin", "berrybase", "pollin", "exlibris", "all"],
        default="all",
    )
    ap.add_argument("--limit", type=int, default=300)
    ap.add_argument(
        "--catalog",
        default="spiele",
        help="Ex Libris only: spiele | musik_cd | musik_vinyl | games | all",
    )
    args = ap.parse_args()
    DATA.mkdir(exist_ok=True)

    if args.supplier == "exlibris":
        session = Session(1.0)
        print("=== scrape exlibris ===", flush=True)
        rows, meta = scrape_exlibris(session, args.limit, catalog=args.catalog)
        write_csv(DATA / "exlibris_sample.csv", FIELDS, rows)
        print(meta, flush=True)
        print("http_stats", dict(session.stats))
        print("Day crawl: python3 scripts/scrape_exlibris.py --catalog spiele --limit 0 --resume")
        return 0

    session = Session(1.0)
    runners = {
        "berrybase": scrape_berrybase,
        "pollin": scrape_pollin,
        "farnell": scrape_farnell,
        "buerklin": scrape_buerklin,
    }
    selected = list(runners) if args.supplier == "all" else [args.supplier]
    for name in selected:
        print(f"=== scrape {name} ===", flush=True)
        rows, meta = runners[name](session, args.limit)
        write_csv(DATA / f"{name}_sample.csv", FIELDS, rows)
        print(meta, flush=True)
    print("http_stats", dict(session.stats))
    print("Tip: if bulk urllib/curl is blocked in this environment, use scripts/download_batch.py + scripts/finalize_from_raw.py")
    print("Ex Libris day crawl: python3 scripts/scrape_exlibris.py --catalog spiele --limit 0 --resume")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
