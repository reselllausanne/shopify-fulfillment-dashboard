import { describe, expect, it } from "vitest";
import {
  expandSnowleaderGraphqlProduct,
  isRetryableSnowleaderGraphqlError,
  parseSnowleaderStock,
  pickSnowleaderProductType,
} from "@/app/lib/snowleaderGraphqlClient";

describe("snowleaderGraphqlClient", () => {
  it("parses stock from inventory_status.total_qty", () => {
    expect(parseSnowleaderStock({ is_in_stock: true, total_qty: "2" })).toEqual({
      stock: 2,
      inStock: true,
    });
    expect(parseSnowleaderStock({ is_in_stock: false, total_qty: "5" })).toEqual({
      stock: 0,
      inStock: false,
    });
  });

  it("expands configurable product into per-size rows with buy price and gtin", () => {
    const rows = expandSnowleaderGraphqlProduct({
      sku: "ON__00907",
      name: "Cloudhorizon 2 M Black/Black",
      url_key: "cloudhorizon-2-m-black-black",
      brand: { name: "On Running" },
      image: { url: "https://images.snowleader.com/test.jpg" },
      media_gallery: [
        { url: "https://images.snowleader.com/test.jpg", position: 0, disabled: false },
        { url: "https://images.snowleader.com/test-2.jpg", position: 1, disabled: false },
      ],
      categories: [
        { id: 596, name: "Sneakers", url_path: "city/sneakers", level: 4 },
      ],
      variants: [
        {
          attributes: [{ label: "42.5", value_index: 929 }],
          product: {
            sku: "ON__00907\\2083349",
            ean: "7615537598628",
            inventory_status: { is_in_stock: true, total_qty: "1" },
            price_range: {
              minimum_price: {
                final_price: { value: 125.9 },
                regular_price: { value: 167.5 },
                discount: { percent_off: 25, amount_off: 41.6 },
              },
            },
          },
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].gtin).toBe("7615537598628");
    expect(rows[0].sizeLabel).toBe("42.5");
    expect(rows[0].stock).toBe(1);
    expect(rows[0].buyPriceChf).toBe(125.9);
    expect(rows[0].galaxusKind).toBe("sneakers");
    expect(rows[0].imageUrls.length).toBeGreaterThan(0);
  });

  it("picks deepest category as product type", () => {
    expect(
      pickSnowleaderProductType([
        { id: "6", name: "Snow", urlPath: "snow", level: 2 },
        { id: "39", name: "Skihosen Damen", urlPath: "snow/skihosen-damen", level: 4 },
      ])
    ).toBe("Skihosen Damen");
  });

  it("flags cloudflare 504 as retryable", () => {
    expect(
      isRetryableSnowleaderGraphqlError(
        new Error('Snowleader GraphQL HTTP 504: {"title":"Error 504: Gateway time-out"}')
      )
    ).toBe(true);
  });
});
