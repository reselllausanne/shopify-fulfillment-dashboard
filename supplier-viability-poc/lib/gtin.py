"""GTIN helpers used by normalize/parsers."""

from __future__ import annotations

import re
from typing import Optional

_DIGITS = re.compile(r"^\d+$")


def normalize_gtin(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    s = re.sub(r"[\s-]", "", str(raw).strip())
    return s or None


def gtin_checksum_ok(digits: str) -> bool:
    if not _DIGITS.match(digits) or len(digits) not in (8, 12, 13, 14):
        return False
    body = [int(d) for d in digits[:-1]]
    check = int(digits[-1])
    total = 0
    weight = 3
    for d in reversed(body):
        total += d * weight
        weight = 1 if weight == 3 else 3
    return ((10 - (total % 10)) % 10) == check


def is_valid_gtin(raw: Optional[str]) -> bool:
    g = normalize_gtin(raw)
    return bool(g and gtin_checksum_ok(g))


def classify_gtin(
    raw: Optional[str],
    *,
    mpn: Optional[str] = None,
    packaging_hint: Optional[str] = None,
) -> dict:
    g = normalize_gtin(raw)
    out = {
        "gtin_raw": raw,
        "gtin": g,
        "valid": False,
        "reason": "missing",
        "mpn_collision": False,
        "packaging_risk": False,
    }
    if not g:
        return out
    if not _DIGITS.match(g) or len(g) not in (8, 12, 13, 14):
        out["reason"] = "bad_length_or_non_digit"
        return out
    if not gtin_checksum_ok(g):
        out["reason"] = "bad_checksum"
        return out
    if mpn:
        mpn_digits = re.sub(r"\D", "", str(mpn))
        if mpn_digits and mpn_digits == g:
            out["mpn_collision"] = True
            out["reason"] = "mpn_as_gtin"
            return out
    pack = (packaging_hint or "").lower()
    if any(t in pack for t in ("multipack", "carton", "tray", "master carton", "vpe", "verpackungseinheit")):
        out["packaging_risk"] = True
        out["reason"] = "packaging_risk"
        out["valid"] = True
        return out
    out["valid"] = True
    out["reason"] = "ok"
    return out
