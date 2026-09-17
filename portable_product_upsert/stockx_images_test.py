import unittest

from stockx_images import (
    is_google_compliant_kickdb_url,
    is_kickdb_thumbnail_url,
    select_stockx_product_images,
    upgrade_kickdb_image_url,
    urls_to_add_for_gallery_sync,
)


class StockxImageSelectionTest(unittest.TestCase):
    def test_static_gallery_hd_precedes_api_thumbnail(self):
        thumbnail = (
            "https://images.stockx.com/images/item.jpg?"
            "fit=fill&w=140&h=100&dpr=2&fm=webp"
        )
        hd = (
            "https://images.stockx.com/images/item.jpg?"
            "fit=fill&w=700&h=500&dpr=2&fm=webp"
        )

        selected = select_stockx_product_images(
            {"image": thumbnail, "gallery": [thumbnail, hd], "gallery_360": []}
        )

        self.assertTrue(selected)
        self.assertTrue(is_google_compliant_kickdb_url(selected[0]))
        self.assertFalse(is_kickdb_thumbnail_url(selected[0]))
        # Hero must be the upgraded/larger asset, never the raw thumb.
        self.assertNotIn("w=140", selected[0])

    def test_lone_thumbnail_is_upgraded_not_dropped(self):
        thumbnail = "https://images.stockx.com/images/item.jpg?w=140&h=100&dpr=2&fm=jpg"
        selected = select_stockx_product_images(
            {"image": thumbnail, "gallery": [], "gallery_360": []}
        )
        self.assertEqual(len(selected), 1)
        self.assertGreaterEqual(int(selected[0].split("w=")[1].split("&")[0]), 1200)
        self.assertTrue(is_google_compliant_kickdb_url(selected[0]))

    def test_360_selection_remains_preferred_and_upgraded(self):
        thumbnail = "https://images.stockx.com/item.jpg?w=140&h=100&dpr=2"
        frame = "https://images.stockx.com/360/item/img01.jpg?w=559&dpr=2"

        selected = select_stockx_product_images(
            {"image": thumbnail, "gallery": [thumbnail], "gallery_360": [frame]}
        )

        self.assertEqual(len(selected), 1)
        self.assertIn("img01", selected[0])
        self.assertTrue(is_google_compliant_kickdb_url(selected[0]))

    def test_upgrade_helper_scales_and_strips_dpr(self):
        thumb = "https://images.stockx.com/images/x.jpg?w=140&h=100&dpr=2&fm=jpg"
        upgraded = upgrade_kickdb_image_url(thumb)
        self.assertNotIn("dpr=", upgraded)
        self.assertIn("w=1200", upgraded)

    def test_gallery_sync_never_appends_raw_thumbnail(self):
        thumb = "https://images.stockx.com/images/x.jpg?w=140&h=100"
        hd = "https://images.stockx.com/images/x.jpg?w=1400&h=1000"
        existing = ["https://cdn.shopify.com/s/files/1/hero.jpg"]
        to_add = urls_to_add_for_gallery_sync([thumb, hd], existing)
        self.assertTrue(to_add)
        for url in to_add:
            self.assertFalse(is_kickdb_thumbnail_url(url))


if __name__ == "__main__":
    unittest.main()
