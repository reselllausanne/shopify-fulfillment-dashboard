"""Tests for Ex Libris physical-only filters."""

from __future__ import annotations

import unittest

from lib.exlibris_filters import (
    filter_product_store,
    filter_tile_dict,
    is_digital_category_path,
)
from lib.parse_exlibris import tile_to_product


class TestExlibrisFilters(unittest.TestCase):
    def test_blocks_ebook_category_path(self):
        self.assertTrue(is_digital_category_path("/de/buecher-buch/e-books-deutsch/foo/ci/1/"))

    def test_blocks_ebook_tile(self):
        tile = {
            "ean": "9783641327972",
            "url": "https://www.exlibris.ch/de/buecher-buch/e-books-deutsch/x/y/id/9783641327972/",
            "path": "/de/buecher-buch/e-books-deutsch/x/y/id/9783641327972/",
            "format": "E-Book (epub)",
            "genre": "E-Book (epub)",
            "category_code": "b",
        }
        keep, reason = filter_tile_dict(tile)
        self.assertFalse(keep)
        self.assertIn("digital", reason)
        self.assertIsNone(tile_to_product(tile))

    def test_keeps_physical_book_tile(self):
        tile = {
            "ean": "9783453443556",
            "url": "https://www.exlibris.ch/de/buecher-buch/deutschsprachige-buecher/x/id/9783453443556/",
            "path": "/de/buecher-buch/deutschsprachige-buecher/x/id/9783453443556/",
            "format": "Kartonierter Einband",
            "genre": "Kartonierter Einband",
            "title": "Die Psychiaterin",
            "sales_price": 21.6,
            "currency": "CHF",
            "availability_text": "Sofort versandbereit",
        }
        keep, _ = filter_tile_dict(tile)
        self.assertTrue(keep)
        row = tile_to_product(tile)
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["sales_unit"], "Kartonierter Einband")

    def test_blocks_download_product_store(self):
        prod = {
            "EAN": "9783641327972",
            "Medium": "E-Book (epub)",
            "ProductCategory": "b-dl",
            "IsDownloadProduct": True,
            "SalesPrice": 18.9,
            "DeepLink": "/de/buecher-buch/e-books-deutsch/x/id/9783641327972/",
        }
        keep, reason = filter_product_store(
            prod, "https://www.exlibris.ch/de/buecher-buch/e-books-deutsch/x/id/9783641327972/"
        )
        self.assertFalse(keep)
        self.assertEqual(reason, "is_download_product")

    def test_keeps_selected_physical_on_pdp_with_siblings(self):
        prod = {
            "EAN": "9783446285644",
            "Medium": "Fester Einband",
            "ProductCategory": "b",
            "IsDownloadProduct": False,
            "SalesPrice": 30,
            "DeepLink": "/de/buecher-buch/deutschsprachige-buecher/alex-capus/querfeldein/id/9783446285644/",
            "Detail": {
                "Relationships": [
                    {"Format": "E-Book (epub)", "Ean": "9783446290006", "SalesPrice": 18.9},
                    {"Format": "Fester Einband", "Ean": "9783446285644", "SalesPrice": 30, "IsSelected": True},
                ]
            },
        }
        keep, _ = filter_product_store(prod, "https://www.exlibris.ch/de/buecher-buch/deutschsprachige-buecher/alex-capus/querfeldein/id/9783446285644/")
        self.assertTrue(keep)


if __name__ == "__main__":
    unittest.main()
