"""Mirror TS shopify/pricing/calcShopifySellPrice.test.ts — 19-Aug formula (aug19-ceil)."""
from __future__ import annotations

import unittest

from shopifyAPI_GQL import calc_sell_price


class CalcSellPriceAug19Test(unittest.TestCase):
    def test_sneaker_samples(self):
        for raw, want in ((100, 192), (108.45, 203), (126, 227), (170, 287), (60, 148), (147, 256), (300, 464)):
            with self.subTest(raw=raw):
                self.assertEqual(calc_sell_price(raw, "sneakers", False, "nike-dunk-low", "nike"), want)

    def test_saucony_discount(self):
        self.assertEqual(calc_sell_price(100, "sneakers", False, "saucony-progrid", "saucony"), 186)

    def test_express(self):
        self.assertEqual(calc_sell_price(100, "sneakers", False, "nike-dunk-low", "nike"), 192)
        self.assertEqual(calc_sell_price(100, "sneakers", True, "nike-dunk-low", "nike"), 212)

    def test_no_cliff(self):
        prev = 0
        for raw in range(80, 400):
            cur = calc_sell_price(raw, "sneakers", False, "nike-dunk-low", "nike")
            self.assertGreaterEqual(cur, prev)
            prev = cur


if __name__ == "__main__":
    unittest.main()
