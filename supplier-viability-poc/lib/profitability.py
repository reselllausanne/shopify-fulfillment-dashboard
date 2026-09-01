"""Profitability — project Galaxus defaults (12% target margin, EURCHF 0.94)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

TARGET_NET_MARGIN = 0.12
DEFAULT_EURCHF = 0.94
RETURN_SAV_RATE = 0.02


@dataclass
class LogisticsProfile:
    supplier: str
    ch_delivery: str
    freight_individual_chf: Optional[float]
    freight_batch_300_chf: Optional[float]
    freight_batch_1000_chf: Optional[float]
    small_order_fee_chf: Optional[float]
    currency_native: str
    notes: str


LOGISTICS = {
    "farnell": LogisticsProfile(
        "farnell",
        "import_predictable",
        None,
        None,
        None,
        None,
        "CHF",
        "CH storefront; API key required; freight unconfirmed without account.",
    ),
    "buerklin": LogisticsProfile(
        "buerklin",
        "import_unknown",
        None,
        None,
        None,
        None,
        "EUR",
        "Cloudflare blocked automation; CH logistics unverified.",
    ),
    "berrybase": LogisticsProfile(
        "berrybase",
        "import_unknown",
        None,
        None,
        None,
        None,
        "EUR",
        "DE shop; CH shipping table not confirmed on probed pages.",
    ),
    "pollin": LogisticsProfile(
        "pollin",
        "import_predictable",
        round(19.90 * DEFAULT_EURCHF, 4),
        round(19.90 * DEFAULT_EURCHF, 4),
        round(19.90 * DEFAULT_EURCHF, 4),
        0.0,
        "EUR",
        "Public CH freight 19.90 EUR; not DDP — customs/VAT via TARES unknown.",
    ),
    "exlibris": LogisticsProfile(
        "exlibris",
        "local_ch",
        0.0,
        0.0,
        0.0,
        0.0,
        "CHF",
        "CH retailer; shop price CHF gross; portofrei typical (shipping 0 in margin model).",
    ),
}


def to_chf(amount: float, currency: str) -> Optional[float]:
    c = (currency or "").upper()
    if c == "CHF":
        return float(amount)
    if c == "EUR":
        return float(amount) * DEFAULT_EURCHF
    return None


def compute_profitability(
    *,
    supplier: str,
    supplier_price: Optional[float],
    currency: str,
    price_basis: str = "gross",
    galaxus_sell_chf: Optional[float],
    scenario: str = "individual",
    moq: Optional[float] = None,
) -> dict:
    log = LOGISTICS[supplier]
    status: list[str] = []
    result = {
        "scenario": scenario,
        "supplier_price_native": supplier_price,
        "currency": currency,
        "price_basis": price_basis,
        "supplier_price_chf": None,
        "freight_chf": None,
        "small_order_fee_chf": log.small_order_fee_chf,
        "customs_clearance_chf": None,
        "landed_cost_chf": None,
        "galaxus_commission_chf": 0.0,
        "return_sav_provision_chf": None,
        "net_revenue_chf": galaxus_sell_chf,
        "estimated_profit_chf": None,
        "margin_pct": None,
        "roi_on_purchase_pct": None,
        "above_threshold": False,
        "status": "",
        "notes": log.notes,
        "ch_delivery": log.ch_delivery,
        "target_margin": TARGET_NET_MARGIN,
    }
    if supplier_price is None or supplier_price <= 0:
        result["status"] = "NO_PRICE"
        return result
    if galaxus_sell_chf is None or galaxus_sell_chf <= 0:
        result["status"] = "NO_GALAXUS_PRICE"
        return result
    if moq is not None:
        try:
            if float(moq) > 1:
                status.append("MOQ_BLOCK")
        except Exception:
            pass
    price_chf = to_chf(float(supplier_price), currency)
    if price_chf is None:
        result["status"] = "FX_UNKNOWN"
        return result
    result["supplier_price_chf"] = round(price_chf, 4)
    freight = {
        "batch_300": log.freight_batch_300_chf,
        "batch_1000": log.freight_batch_1000_chf,
    }.get(scenario, log.freight_individual_chf)
    if freight is None or log.ch_delivery in ("import_unknown", "no_ch_delivery"):
        status.append("NO_CH_DELIVERY" if log.ch_delivery == "no_ch_delivery" else "SHIPPING_UNCONFIRMED")
        result["status"] = "|".join(sorted(set(status)))
        return result
    result["freight_chf"] = round(freight, 4)
    if log.ch_delivery == "import_predictable":
        status.append("CUSTOMS_UNCONFIRMED")
        result["status"] = "|".join(sorted(set(status)))
        return result
    landed = price_chf + freight + (log.small_order_fee_chf or 0)
    result["landed_cost_chf"] = round(landed, 4)
    sav = float(galaxus_sell_chf) * RETURN_SAV_RATE
    result["return_sav_provision_chf"] = round(sav, 4)
    profit = float(galaxus_sell_chf) - landed - sav
    result["estimated_profit_chf"] = round(profit, 4)
    result["margin_pct"] = round(profit / float(galaxus_sell_chf), 4)
    result["roi_on_purchase_pct"] = round(profit / price_chf, 4)
    result["above_threshold"] = result["margin_pct"] >= TARGET_NET_MARGIN
    if not result["above_threshold"]:
        status.append("BELOW_MARGIN_THRESHOLD")
    if profit <= 0:
        status.append("NEGATIVE_PROFIT")
    result["status"] = "|".join(status) if status else "OK"
    return result
