"""Ex Libris parser smoke tests (fixture from live probe HTML)."""

from __future__ import annotations

import unittest
from pathlib import Path

from lib.parse_exlibris import (
    category_total,
    extract_product_tiles,
    parse_product_html,
    tile_to_product,
)

PROBE = Path(__file__).resolve().parents[1] / "_probe" / "exlibris"


@unittest.skipUnless((PROBE / "hobby.html").exists(), "probe hobby.html missing")
class TestExlibris(unittest.TestCase):
    def test_category_tiles(self):
        html = (PROBE / "hobby.html").read_text(encoding="utf-8")
        self.assertGreaterEqual(category_total(html) or 0, 90000)
        tiles = extract_product_tiles(html)
        self.assertGreaterEqual(len(tiles), 20)
        row = tile_to_product(tiles[0], sample_bucket="test")
        self.assertEqual(row["supplier"], "exlibris")
        self.assertEqual(row["currency"], "CHF")
        self.assertTrue(row["gtin"])
        self.assertIn("/id/", row["product_url"])

    def test_pdp(self):
        path = PROBE / "pdp_skyjo.html"
        if not path.exists():
            self.skipTest("pdp fixture missing")
        html = path.read_text(encoding="utf-8")
        row = parse_product_html(
            html,
            "https://www.exlibris.ch/de/hobby-spiele-brettspiele/skyjo/id/4260470080001/",
        )
        self.assertEqual(row["gtin"], "4260470080001")
        self.assertEqual(row["gtin_valid"], "1")
        self.assertEqual(row["brand"], "Magilano")
        self.assertEqual(row["stock"], "in_stock_unquantified")
        self.assertTrue(float(row["price"]) > 0)


if __name__ == "__main__":
    unittest.main()
