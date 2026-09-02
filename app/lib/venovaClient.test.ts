import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import {
  decodePossiblyGzippedXml,
  isVenovaExcludedPath,
  isVenovaProductUrl,
  normalizeVenovaGtin,
  parseVenovaProductHtml,
  parseVenovaWeightKg,
} from "@/app/lib/venovaClient";

const SAMPLE_URL =
  "https://www.venova.ch/de/grill-barbecue/holzkohlegrills/67019/kamado-joe-classic-iii-red-mit-rollwagen";

describe("normalizeVenovaGtin", () => {
  it("accepts valid EAN-13", () => {
    expect(normalizeVenovaGtin("0811738023083")).toEqual({
      gtin: "0811738023083",
      source: "gtin13",
    });
  });

  it("rejects bad check digit", () => {
    expect(normalizeVenovaGtin("0811738023080")).toBeNull();
  });
});

describe("isVenovaProductUrl", () => {
  it("accepts Shopware PDP", () => {
    expect(isVenovaProductUrl(SAMPLE_URL)).toBe(true);
  });

  it("accepts PDP with trailing configurator segment", () => {
    expect(
      isVenovaProductUrl(
        "https://www.venova.ch/de/auto/fahrradtraeger/zubehoer/76/atera-adapterpaket-fuer-atera-dl2/sportm2"
      )
    ).toBe(true);
  });

  it("rejects category / CMS urls", () => {
    expect(isVenovaProductUrl("https://www.venova.ch/de/grill-barbecue/holzkohlegrills/")).toBe(false);
    expect(isVenovaProductUrl("https://www.venova.ch/de/custom/index/sCustom/9")).toBe(false);
    expect(isVenovaProductUrl("https://www.venova.ch/")).toBe(false);
  });
});

describe("isVenovaExcludedPath", () => {
  it("excludes montageservice", () => {
    expect(isVenovaExcludedPath("/de/montageservice/foo")).toBe(true);
  });
});

describe("decodePossiblyGzippedXml", () => {
  it("gunzips sitemap shards", () => {
    const xml =
      '<?xml version="1.0"?><urlset><url><loc>https://www.venova.ch/de/a/1/b</loc></url></urlset>';
    const buf = gzipSync(Buffer.from(xml, "utf8"));
    const decoded = decodePossiblyGzippedXml(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
    expect(decoded).toContain("<loc>");
  });
});

describe("parseVenovaProductHtml", () => {
  it("parses Kamado Joe sample JSON-LD + stock qty", () => {
    const html = `
      <h1>Kamado Joe Classic III Red mit Rollwagen</h1>
      <nav class="breadcrumb">
        <a class="breadcrumb--link">Grill &amp; Barbecue</a>
        <a class="breadcrumb--link">Holzkohlegrills</a>
      </nav>
      <div class="product--buybox">
        <div class="product--delivery for-99978">
          <span class="delivery--text delivery--text-available">Sofort verfügbar</span>
        </div>
        <span class="stock--quantity-number counter--number">2</span> Stück
        <input type="hidden" name="sAdd" value="99978" />
        <li>Hersteller-Art.-Nr.: KJ15040921</li>
        <p>Gewicht: 128 kg</p>
      </div>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Kamado Joe Classic III Red mit Rollwagen",
        "sku": "99978",
        "gtin13": "0811738023083",
        "brand": { "@type": "Brand", "name": "KamadoJoe" },
        "image": ["https://www.venova.ch/media/image/d9/32/d3/99978_1.jpg"],
        "offers": {
          "@type": "Offer",
          "priceCurrency": "CHF",
          "price": "1944.00",
          "availability": "https://schema.org/InStock"
        }
      }
      </script>
    `;
    const product = parseVenovaProductHtml(html, SAMPLE_URL);
    expect(product?.name).toBe("Kamado Joe Classic III Red mit Rollwagen");
    expect(product?.sku).toBe("99978");
    expect(product?.orderNumber).toBe("99978");
    expect(product?.mpn).toBe("KJ15040921");
    expect(product?.gtin).toBe("0811738023083");
    expect(product?.gtinSource).toBe("gtin13");
    expect(product?.priceChf).toBe(1944);
    expect(product?.inStock).toBe(true);
    expect(product?.stock).toBe(2);
    expect(product?.stockSource).toBe("stock_quantity_number");
    expect(product?.weightKg).toBe(128);
    expect(product?.brand).toBe("KamadoJoe");
    expect(product?.productType).toContain("Grill");
    expect(product?.imageUrl).toContain("99978_1.jpg");
  });

  it("parses entry--content MPN/SKU from Shopware base-info", () => {
    const html = `
      <ul class="product--base-info">
        <li><strong class="entry--label">Artikel-Nr.: </strong>
          <meta content="77991"/>
          <span class="entry--content"> 99978 </span>
        </li>
        <li><strong class="entry--label"> Hersteller-Art.-Nr.: </strong>
          <span class="entry--content"> KJ15040921 </span>
        </li>
      </ul>
      <div class="product--delivery for-99978"><span class="delivery--text-available">Sofort verfügbar</span></div>
      <select name="sQuantity"><option value="1">1</option><option value="3">3</option></select>
      <script type="application/ld+json">
      {"@type":"Product","name":"Kamado","sku":"99978","gtin13":"0811738023083","offers":{"price":"1944.00","availability":"https://schema.org/InStock"}}
      </script>
    `;
    const product = parseVenovaProductHtml(html, SAMPLE_URL);
    expect(product?.mpn).toBe("KJ15040921");
    expect(product?.orderNumber).toBe("99978");
    expect(product?.stock).toBe(3);
    expect(product?.stockSource).toBe("sQuantity_max");
  });

  it("zeros stock when OutOfStock", () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"Product","name":"X","sku":"1","gtin13":"0811738023083","offers":{"price":"10.00","availability":"https://schema.org/OutOfStock"}}
      </script>
    `;
    const product = parseVenovaProductHtml(html, SAMPLE_URL);
    expect(product?.stock).toBe(0);
    expect(product?.inStock).toBe(false);
  });

  it("zeros stock on LimitedAvailability / Liefertermin unbekannt", () => {
    const html = `
      <div class="product--delivery for-12575">
        <span class="delivery--text delivery--text-more-is-coming">Liefertermin unbekannt</span>
      </div>
      <select name="sQuantity"><option value="1">1</option><option value="7">7</option></select>
      <script type="application/ld+json">
      {"@type":"Product","name":"X","sku":"12575","gtin13":"0811738023083","offers":{"price":"38.90","availability":"https://schema.org/LimitedAvailability"}}
      </script>
    `;
    const product = parseVenovaProductHtml(html, SAMPLE_URL);
    expect(product?.inStock).toBe(false);
    expect(product?.stock).toBe(0);
  });
});

describe("parseVenovaWeightKg", () => {
  it("reads Gewicht: N kg", () => {
    expect(parseVenovaWeightKg("TECHNISCHE DATEN Gewicht: 128 kg Hitzebereich")).toBe(128);
  });

  it("reads Maschinengewicht from stripped tables", () => {
    const html = `<td>Maschinengewicht</td><td>3 kg&nbsp;</td>`;
    expect(parseVenovaWeightKg(html)).toBe(3);
  });

  it("converts Gramm", () => {
    expect(parseVenovaWeightKg("Das Werkzeug erreicht ein Gewicht von 2200 Gramm bei")).toBe(2.2);
  });

  it("ignores Gegengewicht", () => {
    expect(parseVenovaWeightKg("Druckluftscharnier samt Gegengewicht ausgestattet. Kein Gewicht hier.")).toBeNull();
  });
});
