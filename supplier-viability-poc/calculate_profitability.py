#!/usr/bin/env python3
"""Profitability from galaxus_overlap.csv using project margin defaults."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from run_poc import DATA, profit_one, read_csv, write_csv  # noqa: E402


def main() -> int:
    overlap = read_csv(DATA / "galaxus_overlap.csv")
    rows = []
    for o in overlap:
        try:
            price = float(o["price"]) if o.get("price") else None
        except ValueError:
            price = None
        try:
            sell = float(o["galaxus_sell_price_chf"]) if o.get("galaxus_sell_price_chf") else None
        except ValueError:
            sell = None
        for scenario in ("individual", "batch_300", "batch_1000"):
            pr = profit_one(o["supplier"], price, o.get("currency") or "EUR", sell)
            label = pr["status_label"]
            if o.get("match_status") == "invalid_gtin":
                label = "INVALID_GTIN"
            elif o.get("match_status") == "absent":
                label = "NO_GALAXUS_MATCH"
            elif o.get("match_status") == "ambiguous":
                label = "MANUAL_REVIEW"
            rows.append(
                {
                    "supplier": o.get("supplier", ""),
                    "gtin": o.get("gtin", ""),
                    "name": o.get("name", ""),
                    "match_status": o.get("match_status", ""),
                    "supplier_price": o.get("price", ""),
                    "currency": o.get("currency", ""),
                    "galaxus_sell_price_chf": o.get("galaxus_sell_price_chf", ""),
                    "units_sold": o.get("units_sold", ""),
                    "revenue_chf": o.get("revenue_chf", ""),
                    "scenario": scenario,
                    "freight_chf": pr["freight_chf"],
                    "landed_cost_chf": pr["landed_cost_chf"],
                    "estimated_profit_chf": pr["estimated_profit_chf"],
                    "margin_pct": pr["margin_pct"],
                    "roi_on_purchase_pct": pr["roi_on_purchase_pct"],
                    "above_threshold": pr["above_threshold"],
                    "profit_status": pr["profit_status"],
                    "status_label": label,
                    "ch_delivery": pr["ch_delivery"],
                    "notes": pr["notes"],
                }
            )
    fields = list(rows[0].keys()) if rows else ["supplier", "gtin", "status_label"]
    write_csv(DATA / "profitability_detail.csv", fields, rows)
    viable = [r for r in rows if r["scenario"] == "individual" and r["status_label"] == "VIABLE_NOW"]
    write_csv(DATA / "viable_products.csv", fields, viable)
    print(f"detail={len(rows)} viable_now_rows={len(viable)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
