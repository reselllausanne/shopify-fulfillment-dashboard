import unittest

from stockx_images import select_stockx_product_images


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

        self.assertEqual(selected[0], hd)
        self.assertIn(thumbnail, selected)

    def test_360_selection_remains_preferred(self):
        thumbnail = "https://images.stockx.com/item.jpg?w=140&h=100&dpr=2"
        frame = "https://images.stockx.com/360/item/img01.jpg?w=559&dpr=2"

        selected = select_stockx_product_images(
            {"image": thumbnail, "gallery": [thumbnail], "gallery_360": [frame]}
        )

        self.assertEqual(selected, [frame])


if __name__ == "__main__":
    unittest.main()
