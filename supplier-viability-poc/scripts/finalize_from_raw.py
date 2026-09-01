#!/usr/bin/env python3
"""Parse downloaded HTML → CSVs → overlap → profitability → report."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from run_poc import (  # noqa: E402
    FIELDS,
    SUPPLIERS,
    TARGET,
    apply_gtin,
    empty_row,
    load_index,
    logistics,
    match_all,
    metrics,
    parse_berry,
    parse_pollin,
    profit_one,
    score_supplier,
    write_csv,
    write_report,
)

RAW = ROOT / "_raw"
DATA = ROOT / "data"
REPORTS = ROOT / "reports"


def parse_dir(supplier: str, folder: Path, parse_fn, urls_file: Path | None) -> list[dict]:
    urls = urls_file.read_text().splitlines() if urls_file and urls_file.exists() else []
    rows: list[dict] = []
    files = sorted(folder.glob("p_*.html"))
    for i, fpath in enumerate(files):
        html = fpath.read_text(errors="ignore")
        url = urls[i] if i < len(urls) else f"https://example.invalid/{fpath.name}"
        m = re.search(r'property="og:url"\s+content="([^"]+)"', html)
        if m:
            url = m.group(1)
        head = html[:2500].lower()
        if len(html) < 800 or "just a moment" in head or "access denied" in head:
            rows.append(
                apply_gtin(
                    empty_row(
                        supplier,
                        product_url=url,
                        sample_bucket="commercial" if i < len(files) // 2 else "random",
                        parse_error="blocked_or_empty",
                    )
                )
            )
            continue
        bucket = "commercial" if i < len(files) // 2 else "random"
        rows.append(parse_fn(html, url, bucket))
    return rows


def main() -> int:
    DATA.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)

    berry = parse_dir("berrybase", RAW / "berry" / "products", parse_berry, RAW / "berry" / "download_urls.txt")
    pollin = parse_dir("pollin", RAW / "pollin" / "products", parse_pollin, RAW / "pollin" / "download_urls.txt")
    farnell: list[dict] = []
    buerklin: list[dict] = []
    samples = {"berrybase": berry, "pollin": pollin, "farnell": farnell, "buerklin": buerklin}

    for s, rows in samples.items():
        write_csv(DATA / f"{s}_sample.csv", FIELDS, rows)

    meta = {
        "berrybase": {
            "written": len(berry),
            "target": TARGET,
            "note": f"Partial sample {len(berry)}/{TARGET}: Cursor host allowlist capped bulk fetch; pipeline supports 300.",
        },
        "pollin": {
            "written": len(pollin),
            "target": TARGET,
            "note": f"Partial sample {len(pollin)}/{TARGET}: same bulk-fetch constraint.",
        },
        "farnell": {
            "written": 0,
            "blocked": True,
            "note": "element14 Product Search API requires partner API key; no key in env.",
        },
        "buerklin": {
            "written": 0,
            "blocked": True,
            "note": "Cloudflare challenge (403) — stopped, no CAPTCHA bypass.",
        },
    }
    (DATA / "scrape_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))

    index = load_index(DATA / "galaxus_gtin_index.csv")
    overlap = match_all(index, samples)
    overlap_fields = [
        "supplier", "supplier_sku", "product_url", "name", "brand", "mpn", "gtin", "gtin_valid", "gtin_reason",
        "packaging", "price", "currency", "stock", "match_status", "galaxus_source", "galaxus_title",
        "galaxus_brand", "galaxus_sell_price_chf", "units_sold", "revenue_chf", "last_sale", "our_offer", "notes",
    ]
    write_csv(DATA / "galaxus_overlap.csv", overlap_fields, overlap)

    profit_rows = []
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
            if o["match_status"] == "invalid_gtin":
                label = "INVALID_GTIN"
            elif o["match_status"] == "absent":
                label = "NO_GALAXUS_MATCH"
            elif o["match_status"] == "ambiguous":
                label = "MANUAL_REVIEW"
            profit_rows.append(
                {
                    "supplier": o["supplier"],
                    "gtin": o["gtin"],
                    "name": o["name"],
                    "match_status": o["match_status"],
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
    pfields = list(profit_rows[0].keys()) if profit_rows else ["supplier", "gtin", "status_label"]
    write_csv(DATA / "profitability_detail.csv", pfields, profit_rows)
    viable = [r for r in profit_rows if r["scenario"] == "individual" and r["status_label"] == "VIABLE_NOW"]
    write_csv(DATA / "viable_products.csv", pfields, viable)

    automation = {
        "farnell": {"score": 12, "text": "Official API (key required); order API via account"},
        "buerklin": {"score": 2, "text": "Blocked automation; unknown API"},
        "berrybase": {"score": 8, "text": "Shopware HTML/JSON-LD scrapeable; no public order API found"},
        "pollin": {"score": 9, "text": "Sitemap + JSON-LD; CH freight public; no public order API found"},
    }
    suppliers_ctx = {}
    for s in SUPPLIERS:
        rows = samples.get(s) or []
        m = metrics(rows)
        ov_rows = [o for o in overlap if o["supplier"] == s]
        exact = sum(1 for o in ov_rows if o["match_status"] == "exact")
        valid_tested = sum(1 for o in ov_rows if o["gtin_valid"] == "1")
        revenue = 0.0
        for o in ov_rows:
            if o["match_status"] == "exact":
                try:
                    revenue += float(o.get("revenue_chf") or 0)
                except ValueError:
                    pass
        profitable = sum(
            1
            for r in profit_rows
            if r["supplier"] == s and r["scenario"] == "individual" and r["status_label"] == "VIABLE_NOW"
        )
        log = logistics(s)
        score, verdict = score_supplier(m, exact, valid_tested, profitable, log["ch"], automation[s]["score"])
        notes = [meta[s].get("note", ""), log["notes"], automation[s]["text"]]
        notes.append(f"GTIN valid {m['valid_gtin']}/{m['tested']} ({m['pct_valid_gtin']}%)")
        notes.append(f"Exact Galaxus overlaps: {exact}; viable_now: {profitable}")
        suppliers_ctx[s] = {
            **m,
            "exact_overlap": exact,
            "overlap_rate": round(100 * exact / valid_tested, 1) if valid_tested else 0.0,
            "profitable": profitable,
            "revenue_matched": round(revenue, 2),
            "logistics": log["ch"],
            "automation": automation[s]["text"],
            "score": score,
            "verdict": verdict,
            "notes": [n for n in notes if n],
            "viable_now": profitable,
        }

    ranking = sorted(((s, suppliers_ctx[s]["score"]) for s in suppliers_ctx), key=lambda x: -x[1])
    best_gtin = max(suppliers_ctx.items(), key=lambda kv: kv[1]["pct_valid_gtin"])[0]
    best_overlap = max(suppliers_ctx.items(), key=lambda kv: kv[1]["exact_overlap"])[0]
    best_rev = max(suppliers_ctx.items(), key=lambda kv: kv[1]["revenue_matched"])[0]
    best_margin = max(suppliers_ctx.items(), key=lambda kv: kv[1]["profitable"])[0]
    total_viable = sum(v["viable_now"] for v in suppliers_ctx.values())
    answers = {
        "Q1 Most exploitable GTINs?": f"{best_gtin} (highest valid-GTIN rate among sampled).",
        "Q2 Biggest Galaxus overlap?": (
            "None — 0 exact matches for all 4. Project Galaxus GTIN index is footwear/apparel, not Digitec electronics."
            if all(suppliers_ctx[s]["exact_overlap"] == 0 for s in SUPPLIERS)
            else f"{best_overlap} ({suppliers_ctx[best_overlap]['exact_overlap']} exact)."
        ),
        "Q3 Most historically sold matches?": (
            "None — CHF 0 matched historical revenue (no GTIN hits in GalaxusOrderLine)."
            if all(suppliers_ctx[s]["revenue_matched"] == 0 for s in SUPPLIERS)
            else f"{best_rev} (CHF {suppliers_ctx[best_rev]['revenue_matched']} matched revenue)."
        ),
        "Q4 Most products with sufficient margin?": (
            "None — 0 VIABLE_NOW (need sell prices + confirmed CH landed costs)."
            if total_viable == 0
            else f"{best_margin} with {suppliers_ctx[best_margin]['profitable']} VIABLE_NOW."
        ),
        "Q5 Median margin per supplier?": "Not computable — Galaxus sell prices and/or customs missing ⇒ SHIPPING_UNCONFIRMED / NO_GALAXUS_PRICE.",
        "Q6 Best CH logistics?": "Pollin (public CH freight 19.90 EUR). Still not DDP. Farnell CH storefront but freight unconfirmed. BerryBase/Bürklin unconfirmed/blocked.",
        "Q7 Pollin import predictability?": "Freight predictable (flat CH). Import VAT/duties via Swiss TARES — not DDP; clearance fees unknown ⇒ CUSTOMS_UNCONFIRMED.",
        "Q8 Integrate first?": "Pollin (highest score) only after electronics sell catalog + DDP/customs quantified; else none VIABLE_NOW. Alternate: Farnell via official API if partner key obtained.",
        "Q9 Prioritize which categories?": "Maker/SBC accessories (Raspberry Pi ecosystem, sensors, PSU, cables) once electronics catalog association exists.",
        "Q10 How many VIABLE_NOW publishable?": f"{total_viable}",
        "Q11 Historical CA covered by matches?": f"CHF {round(sum(v['revenue_matched'] for v in suppliers_ctx.values()), 2)} across exact GTIN hits in project sales history.",
        "Q12 Next concrete action?": "1) Import Digitec/Galaxus electronics GTIN sell catalog. 2) Register Farnell element14 API key. 3) Place 1 Pollin CH test order for real landed cost. 4) Re-run POC with 300/supplier outside sandbox.",
    }
    ctx = {
        "suppliers": suppliers_ctx,
        "answers": answers,
        "ranking": ranking,
        "next_action": answers["Q12 Next concrete action?"],
    }
    write_report(REPORTS / "supplier_viability_report.md", ctx)

    print("\n=== DECISION SUMMARY ===")
    for i, (s, score) in enumerate(ranking, 1):
        r = suppliers_ctx[s]
        print(
            f"{i}. {s}: {score}/100 — {r['verdict']} | tested={r['tested']} valid_gtin={r['valid_gtin']} "
            f"overlap={r['exact_overlap']} viable_now={r['viable_now']}"
        )
    print(f"VIABLE_NOW total: {total_viable}")
    print(f"Report: {REPORTS / 'supplier_viability_report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
