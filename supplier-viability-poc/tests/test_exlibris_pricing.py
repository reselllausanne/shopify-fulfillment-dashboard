"""Ex Libris margin + shipping + lead-time tests."""

from __future__ import annotations

import json
import os
import unittest

from lib.exlibris_pricing import (
    apply_exlibris_list_price,
    compute_exlibris_landed_cost,
    parse_exlibris_lead_time,
)


class TestExlibrisPricing(unittest.TestCase):
    def test_portofrei_above_threshold(self):
        cost = compute_exlibris_landed_cost(19.9, availability_text="Sofort versandbereit")
        self.assertIsNotNone(cost)
        assert cost is not None
        self.assertEqual(cost["shipping_chf"], 0.0)
        self.assertEqual(cost["shipping_reason"], "portofrei")
        self.assertEqual(cost["margin_mode"], "percent")
        self.assertEqual(cost["sell_chf"], 25.87)
        self.assertEqual(cost["dispatch_days_min"], 0)
        self.assertEqual(cost["door_days_max"], 3)

    def test_small_order_fee_under_990(self):
        cost = compute_exlibris_landed_cost(1.9)
        assert cost is not None
        self.assertEqual(cost["shipping_chf"], 5.0)
        self.assertEqual(cost["shipping_reason"], "kleinmengenzuschlag")
        self.assertEqual(cost["landed_chf"], 6.9)
        # 30% of 6.9 = 8.97; floor = 6.9+3 = 9.9 → floor wins
        self.assertEqual(cost["margin_mode"], "min_abs_floor")
        self.assertEqual(cost["sell_chf"], 9.9)

    def test_lead_range_werktage(self):
        lead = parse_exlibris_lead_time(
            "Auslieferung erfolgt in der Regel innert 6 bis 8 Werktagen."
        )
        self.assertEqual(lead["dispatch_days_min"], 6)
        self.assertEqual(lead["dispatch_days_max"], 8)
        self.assertEqual(lead["door_days_min"], 8)
        self.assertEqual(lead["door_days_max"], 11)
        self.assertEqual(lead["lead_time_days"], "6-8")

    def test_apply_sets_lead_time(self):
        row = apply_exlibris_list_price(
            {
                "price": "19.9",
                "availability": "Auslieferung erfolgt in der Regel innert 6 bis 8 Werktagen.",
                "price_tiers": "",
                "lead_time_days": "",
            }
        )
        self.assertEqual(row["lead_time_days"], "6-8")
        tiers = json.loads(row["price_tiers"])
        self.assertEqual(tiers["dispatch_days_max"], 8)

    def test_env_margin_override(self):
        prev = os.environ.get("SCRAPER_EXL_MARGIN_PERCENT")
        os.environ["SCRAPER_EXL_MARGIN_PERCENT"] = "20"
        try:
            cost = compute_exlibris_landed_cost(100.0, min_abs_margin_chf=0)
            assert cost is not None
            self.assertEqual(cost["sell_chf"], 120.0)
        finally:
            if prev is None:
                os.environ.pop("SCRAPER_EXL_MARGIN_PERCENT", None)
            else:
                os.environ["SCRAPER_EXL_MARGIN_PERCENT"] = prev


if __name__ == "__main__":
    unittest.main()
