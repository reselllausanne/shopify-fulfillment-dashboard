#!/usr/bin/env python3
"""Unit tests for StockX breadcrumb → Shopify taxonomy mapping."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

# Avoid requiring live Shopify creds for import side effects where possible.
os.environ.setdefault("SHOP_NAME_SHOPIFY", "resell-lausanne")
os.environ.setdefault("ACCESS_TOKEN_SHOPIFY", "test-token")
os.environ.setdefault("API_VERSION_SHOPIFY", "2026-07")

from shopifyAPI_GQL import derive_taxonomy_category  # noqa: E402
from stockx_taxonomy_map import (  # noqa: E402
    GID_ACTIVEWEAR_TSHIRTS,
    GID_HOODIES,
    GID_SWEATPANTS,
    GID_SWEATSHIRTS,
)


def _bc(*parts):
    """parts: (alias, value) triples by level order starting at 1."""
    out = []
    for i, (alias, value) in enumerate(parts, start=1):
        out.append({"level": i, "alias": alias, "value": value})
    return out


class DeriveTaxonomyTests(unittest.TestCase):
    def test_hoodie_stockx_leaf_alias(self):
        data = {
            "title": "Sp5der Souvenir Hoodie Heather Grey",
            "product_type": "streetwear",
            "breadcrumbs": _bc(
                ("apparel", "Apparel"),
                ("tops", "Tops"),
                ("hoodies-and-sweatshirts", "Hoodies & Sweatshirts"),
            ),
        }
        self.assertEqual(derive_taxonomy_category(data), GID_HOODIES)

    def test_hoodie_french_values_only(self):
        data = {
            "title": "Sp5der Souvenir Hoodie Heather Grey",
            "product_type": "streetwear",
            "breadcrumbs": [
                {"level": 1, "value": "Vêtements"},
                {"level": 2, "value": "Hauts"},
                {"level": 3, "value": "Hoodies & Sweatshirts"},
            ],
        }
        self.assertEqual(derive_taxonomy_category(data), GID_HOODIES)

    def test_sweatpants_stockx_leaf(self):
        data = {
            "title": "Sp5der Wait Sweatpant Black",
            "product_type": "streetwear",
            "breadcrumbs": _bc(
                ("apparel", "Apparel"),
                ("bottoms", "Bottoms"),
                ("sweatpants", "Sweatpants"),
            ),
        }
        self.assertEqual(derive_taxonomy_category(data), GID_SWEATPANTS)

    def test_sweatpants_french_jogging(self):
        data = {
            "title": "Sp5der Wait Sweatpant Black",
            "product_type": "streetwear",
            "breadcrumbs": [
                {"level": 1, "value": "Vêtements"},
                {"level": 2, "value": "Bas"},
                {"level": 3, "value": "Pantalons de jogging"},
            ],
        }
        self.assertEqual(derive_taxonomy_category(data), GID_SWEATPANTS)

    def test_crewneck_under_hoodies_leaf(self):
        data = {
            "title": "Fear of God Essentials MLB Sport Crewneck Seal",
            "product_type": "streetwear",
            "breadcrumbs": _bc(
                ("apparel", "Apparel"),
                ("tops", "Tops"),
                ("hoodies-and-sweatshirts", "Hoodies & Sweatshirts"),
            ),
        }
        self.assertEqual(derive_taxonomy_category(data), GID_SWEATSHIRTS)

    def test_streetwear_does_not_beat_title(self):
        data = {
            "title": "Some Brand Hoodie Black",
            "product_type": "streetwear",
            "breadcrumbs": [],
        }
        self.assertEqual(derive_taxonomy_category(data), GID_HOODIES)

    def test_tshirt_leaf(self):
        data = {
            "title": "Hellstar Gridiron T-Shirt Black",
            "product_type": "streetwear",
            "breadcrumbs": _bc(
                ("apparel", "Apparel"),
                ("tops", "Tops"),
                ("t-shirts", "T-Shirts"),
            ),
        }
        self.assertEqual(derive_taxonomy_category(data), GID_ACTIVEWEAR_TSHIRTS)


if __name__ == "__main__":
    unittest.main()
