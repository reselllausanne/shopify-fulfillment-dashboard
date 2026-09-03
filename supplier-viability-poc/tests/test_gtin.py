#!/usr/bin/env python3
"""Unit tests — GTIN validation."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from run_poc import classify_gtin, gtin_checksum_ok, normalize_gtin  # noqa: E402


class TestGtin(unittest.TestCase):
    def test_valid_ean13(self):
        # 4006381333931 is a classic valid EAN-13
        self.assertTrue(gtin_checksum_ok("4006381333931"))
        cls = classify_gtin("4006381333931")
        self.assertTrue(cls["valid"])
        self.assertEqual(cls["reason"], "ok")

    def test_invalid_checksum(self):
        self.assertFalse(gtin_checksum_ok("4006381333932"))
        cls = classify_gtin("4006381333932")
        self.assertFalse(cls["valid"])
        self.assertEqual(cls["reason"], "bad_checksum")

    def test_normalize(self):
        self.assertEqual(normalize_gtin(" 4 006-381333931 "), "4006381333931")

    def test_mpn_collision(self):
        cls = classify_gtin("4006381333931", mpn="4006381333931")
        self.assertTrue(cls["mpn_collision"])
        self.assertFalse(cls["valid"])

    def test_packaging_risk(self):
        cls = classify_gtin("4006381333931", packaging="multipack carton")
        self.assertTrue(cls["valid"])
        self.assertTrue(cls["packaging_risk"])

    def test_bad_length(self):
        cls = classify_gtin("12345")
        self.assertEqual(cls["reason"], "bad_length_or_non_digit")


if __name__ == "__main__":
    unittest.main()
