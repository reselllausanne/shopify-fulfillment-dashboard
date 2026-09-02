import { describe, expect, it } from "vitest";
import {
  articleIdFromBabyWalzUrl,
  isBabyWalzProductUrl,
  normalizeBabyWalzGtin,
  parseBabyWalzProductHtml,
} from "@/app/lib/babyWalzClient";

const SAMPLE_URL = "https://www.baby-walz.ch/de/p/lego-43257-angel-8409994/";

describe("normalizeBabyWalzGtin", () => {
  it("accepts valid EAN-13", () => {
    expect(normalizeBabyWalzGtin("5702017813967")).toEqual({
      gtin: "5702017813967",
      source: "gtin13",
    });
  });

  it("rejects bad check digit", () => {
    expect(normalizeBabyWalzGtin("5702017813960")).toBeNull();
  });
});

describe("isBabyWalzProductUrl", () => {
  it("accepts CH DE PDP", () => {
    expect(isBabyWalzProductUrl(SAMPLE_URL)).toBe(true);
  });

  it("rejects FR locale by default", () => {
    expect(
      isBabyWalzProductUrl("https://www.baby-walz.ch/fr/p/lego-43257-angel-8409994/")
    ).toBe(false);
  });

  it("rejects category urls", () => {
    expect(isBabyWalzProductUrl("https://www.baby-walz.ch/de/spielzeug/")).toBe(false);
  });
});

describe("articleIdFromBabyWalzUrl", () => {
  it("parses trailing article id", () => {
    expect(articleIdFromBabyWalzUrl(SAMPLE_URL)).toBe("8409994");
  });
});

describe("parseBabyWalzProductHtml", () => {
  it("parses Nuxt payload variants with EAN + stock + size", () => {
    // Minimal Nuxt devalue-style payload mirroring baby-walz SSR shape.
    const payload = [
      ["ShallowReactive", 1],
      {
        data: 2,
        state: -1,
        once: -1,
        _errors: -1,
        serverRendered: 3,
        path: 4,
        pinia: -1,
      },
      ["ShallowReactive", 5],
      true,
      "/de/p/lego-43257-angel-8409994/",
      {
        "product:8409994": 6,
      },
      {
        product: 7,
        detail: -1,
        variantDetails: 8,
      },
      {
        id: 9,
        referenceKey: 10,
        seoUrl: 11,
        isActive: 3,
        isSoldOut: 12,
        isNew: 12,
        sale: 12,
        masterKey: 13,
        name: 14,
        brand: 15,
        artikelThema: -1,
        collections: -1,
        images: 16,
        downloadAssets: -1,
        promo: -1,
        categories: -1,
        variants: 17,
        siblings: -1,
        attributes: -1,
        advancedAttributes: -1,
        priceRange: -1,
        sequence: -1,
        breadcrumbs: 18,
      },
      {
        "8409994": 19,
      },
      892396,
      "8409994",
      "/p/lego-43257-angel-8409994/",
      false,
      "P1841350",
      "43257 Angel",
      "LEGO®",
      [20],
      [21],
      [22],
      {
        stock: 23,
        kqpri: -1,
        isBulkyOrLoad: 12,
        badges: -1,
        priceOptions: -1,
        attributes: -1,
        advancedAttributes: 24,
        description: -1,
        manufacturer: -1,
        warnings: -1,
        careHints: -1,
        customization: -1,
        contentChecks: -1,
      },
      { src: 25, name: 26, displayLocales: -1 },
      {
        id: 27,
        referenceKey: 10,
        price: 28,
        KQPRI: -1,
        stock: 23,
        isProductBuyable: 3,
        isProductAdvisible: 3,
        isValid: 3,
        attributes: 29,
        advancedAttributes: -1,
      },
      { label: 30, to: 31 },
      {
        supplierId: 32,
        warehouseId: 33,
        quantity: 34,
        isSellableWithoutStock: 12,
        expectedAvailabilityAt: -1,
      },
      { asGro: 35 },
      "images/4efa772d9defdeaddb300a1f7dcdf346.jpg",
      "8409994_03.jpg",
      3799681,
      {
        currencyCode: 36,
        withTax: 37,
        withoutTax: 38,
        beforeSaleWithTax: 39,
        recommendedRetailPrice: 39,
        tax: -1,
        appliedReductions: -1,
        totalAppliedReductions: -1,
        reductionsRelativeTo: -1,
      },
      { ean: 40, bulkyOrLoad: -1, isSale: -1 },
      "Spielzeug",
      "/de/spielzeug",
      1,
      457,
      4,
      {
        id: 41,
        key: 42,
        label: 43,
        type: 44,
        values: 45,
      },
      "CHF",
      4595,
      4251,
      7490,
      {
        id: 46,
        key: 47,
        label: 47,
        type: 48,
        multiSelect: 12,
        values: 49,
      },
      1516,
      "asGro",
      "Größe",
      "advancedAttribute",
      [
        {
          fieldSet: 50,
          groupSet: 51,
        },
      ],
      20009,
      "ean",
      "string",
      { id: 46, label: 47, value: 52 },
      [53],
      [],
      "5702017813967",
      [54],
      { value: 55 },
      "35",
    ];

    const html = `
      <title>LEGO® - 43257 Angel</title>
      <script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">${JSON.stringify(
        payload
      )}</script>
    `;

    const products = parseBabyWalzProductHtml(html, SAMPLE_URL);
    expect(products).toHaveLength(1);
    expect(products[0]?.gtin).toBe("5702017813967");
    expect(products[0]?.gtinSource).toBe("gtin13");
    expect(products[0]?.priceChf).toBe(45.95);
    expect(products[0]?.stock).toBe(4);
    expect(products[0]?.inStock).toBe(true);
    expect(products[0]?.brand).toBe("LEGO®");
    expect(products[0]?.name).toBe("43257 Angel");
    expect(products[0]?.articleId).toBe("8409994");
    expect(products[0]?.sizeRaw).toBe("35");
    expect(products[0]?.productType).toBe("Spielzeug");
    expect(products[0]?.imageUrl).toContain("walz-live.cdn.aboutyou.cloud/images/");
    expect(products[0]?.bulkyOrLoad).toBe(false);
  });

  it("sets stock 0 when sold out", () => {
    const payload = [
      ["ShallowReactive", 1],
      { data: 2, serverRendered: 3 },
      ["ShallowReactive", 4],
      true,
      { "product:8409994": 5 },
      { product: 6, variantDetails: 7 },
      {
        id: 8,
        referenceKey: 9,
        isSoldOut: 3,
        name: 10,
        brand: 11,
        images: 12,
        variants: 13,
        breadcrumbs: 14,
        masterKey: 15,
      },
      {},
      1,
      "8409994",
      "Gone",
      "LEGO®",
      [],
      [16],
      [],
      "P1",
      {
        id: 17,
        referenceKey: 9,
        price: 18,
        stock: 19,
        isProductBuyable: 20,
        attributes: 21,
      },
      2,
      {
        currencyCode: 22,
        withTax: 23,
      },
      {
        quantity: 24,
      },
      false,
      { ean: 25 },
      "CHF",
      1000,
      0,
      {
        values: 26,
      },
      { value: 27 },
      "5702017813967",
    ];
    const html = `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(
      payload
    )}</script>`;
    const products = parseBabyWalzProductHtml(html, SAMPLE_URL);
    expect(products).toHaveLength(1);
    expect(products[0]?.stock).toBe(0);
    expect(products[0]?.inStock).toBe(false);
  });
});
