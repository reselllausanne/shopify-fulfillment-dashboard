"""Mirror TS shopify/pricing/calcShopifySellPrice.test.ts — HALF only, no FULL CPA."""
from __future__ import annotations

import unittest

from shopifyAPI_GQL import calc_sell_price


# Live cost band — buy CHF 140 ≈ stockx_raw 108.45 → HALF 239 (not FULL 249).
RAW_FROM_BUY_140 = 108.45
EXPECTED_HALF_SELL_FROM_BUY_140 = 239

ADIDAS_LIFESTYLE = [
    ("Samba", "adidas-samba-og-cloud-white-core-black"),
    ("Gazelle", "adidas-gazelle-indoor-blue-bird"),
    ("Spezial", "adidas-handball-spezial-grey"),
    ("Campus", "adidas-campus-00s-grey-white"),
]


class CalcSellPriceHalfOnlyTest(unittest.TestCase):
    def test_brands_same_half_only(self):
        adidas = calc_sell_price(
            100, "sneakers", False, "adidas-samba-xlg-black-carbon", "adidas"
        )
        nike = calc_sell_price(100, "sneakers", False, "nike-dunk-low", "nike")
        saucony = calc_sell_price(100, "sneakers", False, "saucony-progrid", "saucony")
        self.assertEqual(adidas, 229)
        self.assertEqual(adidas, nike)
        self.assertEqual(adidas, saucony)

    def test_adidas_lifestyle_families_half_not_full(self):
        for family, handle in ADIDAS_LIFESTYLE:
            with self.subTest(family=family):
                sell = calc_sell_price(
                    RAW_FROM_BUY_140, "sneakers", False, handle, "adidas"
                )
                self.assertEqual(sell, EXPECTED_HALF_SELL_FROM_BUY_140)
                self.assertNotEqual(sell, 249)

    def test_live_sse_cost_samples(self):
        self.assertEqual(
            calc_sell_price(100, "sneakers", False, "adidas-samba-og-white", "adidas"),
            229,
        )
        self.assertEqual(
            calc_sell_price(126, "sneakers", False, "adidas-gazelle-indoor", "adidas"),
            269,
        )
        self.assertEqual(
            calc_sell_price(170, "sneakers", False, "adidas-handball-spezial", "adidas"),
            339,
        )


if __name__ == "__main__":
    unittest.main()
