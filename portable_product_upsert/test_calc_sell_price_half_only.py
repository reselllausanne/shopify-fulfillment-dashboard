"""Mirror TS shopify/pricing/calcShopifySellPrice.test.ts — locked CM2 floor, whole CHF."""
from __future__ import annotations

import unittest

from shopifyAPI_GQL import calc_sell_price


EXPECTED_SELL_RAW_100 = 210
EXPECTED_SELL_RAW_108_45 = 224
EXPECTED_SELL_RAW_126 = 252
EXPECTED_SELL_RAW_170 = 321
RAW_FROM_BUY_140 = 108.45

ADIDAS_LIFESTYLE = [
    ("Samba", "adidas-samba-og-cloud-white-core-black"),
    ("Gazelle", "adidas-gazelle-indoor-blue-bird"),
    ("Spezial", "adidas-handball-spezial-grey"),
    ("Campus", "adidas-campus-00s-grey-white"),
]


class CalcSellPriceLockedTest(unittest.TestCase):
    def test_brands_same(self):
        adidas = calc_sell_price(
            100, "sneakers", False, "adidas-samba-xlg-black-carbon", "adidas"
        )
        nike = calc_sell_price(100, "sneakers", False, "nike-dunk-low", "nike")
        saucony = calc_sell_price(100, "sneakers", False, "saucony-progrid", "saucony")
        self.assertEqual(adidas, EXPECTED_SELL_RAW_100)
        self.assertEqual(adidas, nike)
        self.assertEqual(adidas, saucony)

    def test_adidas_lifestyle_families(self):
        for family, handle in ADIDAS_LIFESTYLE:
            with self.subTest(family=family):
                sell = calc_sell_price(
                    RAW_FROM_BUY_140, "sneakers", False, handle, "adidas"
                )
                self.assertEqual(sell, EXPECTED_SELL_RAW_108_45)

    def test_live_sse_cost_samples(self):
        self.assertEqual(
            calc_sell_price(100, "sneakers", False, "adidas-samba-og-white", "adidas"),
            EXPECTED_SELL_RAW_100,
        )
        self.assertEqual(
            calc_sell_price(126, "sneakers", False, "adidas-gazelle-indoor", "adidas"),
            EXPECTED_SELL_RAW_126,
        )
        self.assertEqual(
            calc_sell_price(170, "sneakers", False, "adidas-handball-spezial", "adidas"),
            EXPECTED_SELL_RAW_170,
        )


if __name__ == "__main__":
    unittest.main()
