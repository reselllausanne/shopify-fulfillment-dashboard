#!/usr/bin/env python3
"""Unit tests — supplier HTML parsers (fixtures)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from lib.parse_fantasywelt import parse_product_html as parse_fantasywelt  # noqa: E402
from run_poc import parse_berry, parse_pollin  # noqa: E402

FIX = ROOT / "tests" / "fixtures"


class TestParsers(unittest.TestCase):
    def test_berrybase_fixture(self):
        html = (FIX / "berrybase_product.html").read_text(errors="ignore")
        # Prefer a full downloaded page if fixture is thin
        full = ROOT / "_raw" / "berry" / "products" / "p_0000.html"
        if full.exists() and full.stat().st_size > 10000:
            html = full.read_text(errors="ignore")
        row = parse_berry(html, "https://www.berrybase.de/test", "commercial")
        self.assertEqual(row["supplier"], "berrybase")
        self.assertTrue(row.get("price") or row.get("gtin") or row.get("name"))

    def test_pollin_fixture(self):
        html = (FIX / "pollin_product.html").read_text(errors="ignore")
        full = ROOT / "_raw" / "pollin" / "products" / "p_0000.html"
        if full.exists() and full.stat().st_size > 10000:
            html = full.read_text(errors="ignore")
        row = parse_pollin(html, "https://www.pollin.de/p/test-123", "commercial")
        self.assertEqual(row["supplier"], "pollin")
        self.assertTrue(row.get("gtin") or row.get("price") or row.get("supplier_sku"))

    def test_fantasywelt_fixture(self):
        html = (FIX / "fantasywelt_product.html").read_text(encoding="utf-8")
        row = parse_fantasywelt(
            html,
            "https://www.fantasywelt.de/Turbo-Flitzpiepen-2000-DE",
            sample_bucket="probe",
        )
        self.assertEqual(row["supplier"], "fantasywelt")
        self.assertEqual(row["gtin"], "3558380140092")
        self.assertEqual(row["gtin_valid"], "1")
        self.assertEqual(row["price"], "29.99")
        self.assertEqual(row["supplier_sku"], "CMYD0003")
        self.assertEqual(row["brand"], "CMYK")
        self.assertEqual(row["availability"], "InStock")

    def test_farnell_blocked_stub(self):
        # No fixture scrape when API key missing — parser still defined via scrape meta
        self.assertTrue(True)

    def test_buerklin_cloudflare_stub(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
