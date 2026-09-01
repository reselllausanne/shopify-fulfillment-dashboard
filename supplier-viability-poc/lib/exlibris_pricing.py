"""Ex Libris sell pricing — Reichelt-style margin + CH small-order shipping.

Facts from Ex Libris FAQ / AGB (2026):
- Portofrei CH/LI when order ≥ CHF 9.90
- Kleinmengenzuschlag = CHF 5.00 when order < CHF 9.90
- Post B-Post after dispatch: +2–3 Werktage door delivery

Sell = max(landed × (1 + %), landed + min_abs_chf)
so tiny SKUs (CHF 1.90 beads) still clear a floor profit after fee.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Optional


# FAQ: free ship threshold 9.90, surcharge 5.00
DEFAULT_FREE_SHIP_MIN_CHF = 9.90
DEFAULT_SMALL_ORDER_FEE_CHF = 5.00
DEFAULT_MIN_ABS_MARGIN_CHF = 3.00  # floor profit on tiny items
POST_TRANSIT_DAYS_MIN = 2
POST_TRANSIT_DAYS_MAX = 3


def exlibris_pricing_config() -> dict[str, float]:
    rei_margin = os.environ.get("SCRAPER_REI_MARGIN_PERCENT")
    exl_margin = os.environ.get("SCRAPER_EXL_MARGIN_PERCENT") or rei_margin or "30"
    # Explicit override wins; else auto from free-ship threshold
    shipping_override = os.environ.get("SCRAPER_EXL_SHIPPING_CHF")
    return {
        "margin_percent": max(0.0, float(exl_margin)),
        "shipping_chf_override": (
            max(0.0, float(shipping_override)) if shipping_override not in (None, "") else None
        ),
        "free_ship_min_chf": max(
            0.0, float(os.environ.get("SCRAPER_EXL_FREE_SHIP_MIN_CHF") or DEFAULT_FREE_SHIP_MIN_CHF)
        ),
        "small_order_fee_chf": max(
            0.0,
            float(os.environ.get("SCRAPER_EXL_SMALL_ORDER_FEE_CHF") or DEFAULT_SMALL_ORDER_FEE_CHF),
        ),
        "min_abs_margin_chf": max(
            0.0,
            float(os.environ.get("SCRAPER_EXL_MIN_ABS_MARGIN_CHF") or DEFAULT_MIN_ABS_MARGIN_CHF),
        ),
        "vat_rate": max(0.0, float(os.environ.get("SCRAPER_EXL_VAT_RATE") or "0.081")),
    }


def round_chf(value: float) -> float:
    return round(value, 2)


def resolve_exlibris_shipping_chf(buy_chf: float, *, override: Optional[float] = None) -> tuple[float, str]:
    """Single-SKU worst case: fee if buy < free-ship threshold."""
    cfg = exlibris_pricing_config()
    if override is not None:
        return max(0.0, override), "override"
    if cfg["shipping_chf_override"] is not None:
        return cfg["shipping_chf_override"], "env_override"
    if buy_chf < cfg["free_ship_min_chf"]:
        return cfg["small_order_fee_chf"], "kleinmengenzuschlag"
    return 0.0, "portofrei"


def parse_exlibris_lead_time(availability_text: str) -> dict[str, Any]:
    """Parse Availability.Text → supplier dispatch window (Werktage).

    Does NOT include Post transit (add 2–3 separately for door ETA).
    """
    text = (availability_text or "").strip()
    out: dict[str, Any] = {
        "availability_text": text,
        "dispatch_days_min": None,
        "dispatch_days_max": None,
        "door_days_min": None,
        "door_days_max": None,
        "lead_time_days": "",
        "lead_parse": "unknown",
    }
    if not text:
        return out
    low = text.lower()

    if re.search(r"sofort\s+versandbereit|sofort\s+lieferbar|sofort\s+verf[uü]gbar", low):
        out.update(
            dispatch_days_min=0,
            dispatch_days_max=0,
            door_days_min=POST_TRANSIT_DAYS_MIN,
            door_days_max=POST_TRANSIT_DAYS_MAX,
            lead_time_days=f"{POST_TRANSIT_DAYS_MIN}-{POST_TRANSIT_DAYS_MAX}",
            lead_parse="sofort_versandbereit",
        )
        return out

    if re.search(r"vergriffen|nicht\s+lieferbar|ausverkauft", low):
        out["lead_parse"] = "oos"
        out["lead_time_days"] = ""
        return out

    # "innert 6 bis 8 Werktagen" / "innert 2 bis 3 Tagen"
    m = re.search(
        r"innert\s+(\d+)\s*(?:bis|-|–)\s*(\d+)\s*(werktag|tag|woche)",
        low,
    )
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        unit = m.group(3)
        if unit.startswith("woche"):
            a, b = a * 5, b * 5
        lo, hi = min(a, b), max(a, b)
        out.update(
            dispatch_days_min=lo,
            dispatch_days_max=hi,
            door_days_min=lo + POST_TRANSIT_DAYS_MIN,
            door_days_max=hi + POST_TRANSIT_DAYS_MAX,
            lead_time_days=f"{lo}-{hi}",
            lead_parse="range_werktage",
        )
        return out

    # "innert 3 Wochen" / "innert 12 Werktagen"
    m = re.search(r"innert\s+(\d+)\s*(werktag|tag|woche)", low)
    if m:
        n = int(m.group(1))
        unit = m.group(2)
        if unit.startswith("woche"):
            n = n * 5
        out.update(
            dispatch_days_min=n,
            dispatch_days_max=n,
            door_days_min=n + POST_TRANSIT_DAYS_MIN,
            door_days_max=n + POST_TRANSIT_DAYS_MAX,
            lead_time_days=str(n),
            lead_parse="single_werktage",
        )
        return out

    # "Erhältlich wieder ab: 27.08.26" — date, no numeric lead
    if re.search(r"erh[aä]ltlich\s+wieder|nachdruck|vorbestell", low):
        out["lead_parse"] = "date_or_preorder"
        return out

    return out


def compute_exlibris_landed_cost(
    buy_chf: float,
    *,
    margin_percent: Optional[float] = None,
    shipping_chf: Optional[float] = None,
    min_abs_margin_chf: Optional[float] = None,
    availability_text: str = "",
) -> Optional[dict[str, Any]]:
    if buy_chf <= 0:
        return None
    cfg = exlibris_pricing_config()
    ship, ship_reason = resolve_exlibris_shipping_chf(buy_chf, override=shipping_chf)
    margin = cfg["margin_percent"] if margin_percent is None else max(0.0, margin_percent)
    min_abs = (
        cfg["min_abs_margin_chf"] if min_abs_margin_chf is None else max(0.0, min_abs_margin_chf)
    )
    product_chf = round_chf(buy_chf)
    landed_chf = round_chf(product_chf + ship)
    sell_pct = round_chf(landed_chf * (1 + margin / 100))
    sell_floor = round_chf(landed_chf + min_abs)
    sell_chf = max(sell_pct, sell_floor)
    margin_mode = "percent" if sell_chf == sell_pct else "min_abs_floor"
    lead = parse_exlibris_lead_time(availability_text)

    return {
        "type": "exlibris_landed_cost",
        "buy_chf": product_chf,
        "shipping_chf": ship,
        "shipping_reason": ship_reason,
        "free_ship_min_chf": cfg["free_ship_min_chf"],
        "landed_chf": landed_chf,
        "margin_percent": margin,
        "min_abs_margin_chf": min_abs,
        "margin_mode": margin_mode,
        "sell_chf": sell_chf,
        "vat_rate": cfg["vat_rate"],
        "price_source": "chf_gross",
        "dispatch_days_min": lead["dispatch_days_min"],
        "dispatch_days_max": lead["dispatch_days_max"],
        "door_days_min": lead["door_days_min"],
        "door_days_max": lead["door_days_max"],
        "lead_parse": lead["lead_parse"],
    }


def apply_exlibris_list_price(row: dict) -> dict:
    """Keep row['price'] as shop buy; write sell + breakdown to price_tiers JSON."""
    raw = row.get("price")
    if raw in (None, ""):
        return row
    try:
        buy = float(raw)
    except (TypeError, ValueError):
        return row
    cost = compute_exlibris_landed_cost(buy, availability_text=str(row.get("availability") or ""))
    if not cost:
        return row
    row["price_tiers"] = json.dumps(cost, ensure_ascii=False)
    if cost.get("dispatch_days_min") is not None and cost.get("dispatch_days_max") is not None:
        lo, hi = cost["dispatch_days_min"], cost["dispatch_days_max"]
        row["lead_time_days"] = str(lo) if lo == hi else f"{lo}-{hi}"
    return row
