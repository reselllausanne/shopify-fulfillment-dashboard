"""Quick unit checks: python3 admin_only_products_test.py"""
from admin_only_products import is_in_stock_fixed_price_product


def test_ids():
    assert is_in_stock_fixed_price_product(product_id="15115016831362")
    assert is_in_stock_fixed_price_product(product_id="gid://shopify/Product/15356478325122")
    assert is_in_stock_fixed_price_product(product_id="15340411617666")
    assert not is_in_stock_fixed_price_product(product_id="999999999")


def test_titles():
    assert is_in_stock_fixed_price_product(
        title="Travis Scott CJ x Audemars Piguet Watch Face Tee Green"
    )
    assert is_in_stock_fixed_price_product(title="Essentials Tee Stretch Limo SS22")
    assert is_in_stock_fixed_price_product(title="BAPE Big Ape Head Tee White")
    assert not is_in_stock_fixed_price_product(
        title="Nike Air Max 1 Essential Light Bone/Psychic Blue"
    )


def test_skus():
    assert is_in_stock_fixed_price_product(sku="125HO244368F-M")
    assert is_in_stock_fixed_price_product(sku="192HO246258F")
    assert not is_in_stock_fixed_price_product(sku="FZ5808-009-44")


if __name__ == "__main__":
    test_ids()
    test_titles()
    test_skus()
    print("ok")
