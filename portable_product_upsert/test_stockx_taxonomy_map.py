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
    GID_BOOTS,
    GID_HOODIES,
    GID_OUTFIT_SETS,
    GID_SPORTS_FAN_ACCESSORIES,
    GID_SWEATPANTS,
    GID_SWEATSHIRTS,
    GID_WALLETS,
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

    def test_sets_and_bundles_to_outfit_sets(self):
        data = {
            "title": "Nike Tech Fleece Tracksuit Black",
            "product_type": "streetwear",
            "breadcrumbs": _bc(
                ("apparel", "Apparel"),
                ("other-apparel", "Other Apparel"),
                ("sets-and-bundles", "Sets And Bundles"),
            ),
        }
        self.assertEqual(derive_taxonomy_category(data), GID_OUTFIT_SETS)

    def test_sets_and_bundles_display_value_only(self):
        data = {
            "title": "Nike Tech Fleece Tracksuit Black",
            "product_type": "streetwear",
            "breadcrumbs": [
                {"level": 1, "value": "Apparel"},
                {"level": 2, "value": "Other Apparel"},
                {"level": 3, "value": "Sets And Bundles"},
            ],
        }
        self.assertEqual(derive_taxonomy_category(data), GID_OUTFIT_SETS)

    def test_sports_equipment_to_sports_fan_accessories(self):
        data = {
            "title": "Wilson NBA Official Game Ball",
            "product_type": "collectibles",
            "breadcrumbs": _bc(
                ("collectibles", "Collectibles"),
                ("sports-equipment", "Sports Equipment"),
            ),
        }
        self.assertEqual(derive_taxonomy_category(data), GID_SPORTS_FAN_ACCESSORIES)

    def test_sports_equipment_display_value_only(self):
        data = {
            "title": "Wilson NBA Official Game Ball",
            "product_type": "collectibles",
            "breadcrumbs": [
                {"level": 1, "value": "Collectibles"},
                {"level": 2, "value": "Sports Equipment"},
            ],
        }
        self.assertEqual(derive_taxonomy_category(data), GID_SPORTS_FAN_ACCESSORIES)

    def test_wallets_leaf(self):
        data = {
            "title": "Gucci GG Marmont Wallet",
            "product_type": "accessories",
            "breadcrumbs": _bc(
                ("accessories", "Accessories"),
                ("wallets-and-card-holders", "Wallets And Card Holders"),
                ("wallets", "Wallets"),
            ),
        }
        self.assertEqual(derive_taxonomy_category(data), GID_WALLETS)

    def test_wallets_display_value_only(self):
        data = {
            "title": "Gucci GG Marmont Wallet",
            "product_type": "accessories",
            "breadcrumbs": [
                {"level": 1, "value": "Accessories"},
                {"level": 2, "value": "Wallets And Card Holders"},
                {"level": 3, "value": "Wallets"},
            ],
        }
        self.assertEqual(derive_taxonomy_category(data), GID_WALLETS)

    def test_boots_leaf_beats_shoes_sneakers(self):
        data = {
            "title": "Timberland 6 Inch Premium Boot Wheat",
            "product_type": "sneakers",
            "breadcrumbs": _bc(
                ("shoes", "Shoes"),
                ("boots", "Boots"),
            ),
        }
        self.assertEqual(derive_taxonomy_category(data), GID_BOOTS)

    def test_boots_display_value_only(self):
        data = {
            "title": "Timberland 6 Inch Premium Boot Wheat",
            "product_type": "sneakers",
            "breadcrumbs": [
                {"level": 1, "value": "Shoes"},
                {"level": 2, "value": "Boots"},
            ],
        }
        self.assertEqual(derive_taxonomy_category(data), GID_BOOTS)


if __name__ == "__main__":
    unittest.main()
