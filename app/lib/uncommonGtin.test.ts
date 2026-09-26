import { describe, expect, it } from "vitest";
import {
  buildWelGtinIndex,
  isUncommonParentUrlWithoutLangAttr,
  matchWelGtinForUncommon,
  parseUncommonCardLang,
  resolveUncommonGtinFromHtml,
} from "@/app/lib/uncommonGtin";

const ARCHAZIA_GROUP_HTML = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "ProductGroup",
      "name": "Disney Lorcana - Archazia's Insel - Booster Display",
      "sku": "LO.II.E.ArchaziaDis.DE",
      "gtin": "4050368985590",
      "hasVariant": [
        {
          "@type": "Product",
          "name": "Disney Lorcana - Archazia's Insel - Booster Display - franzosisch",
          "url": "https://theuncommonshop.ch/product/disney-lorcana-archazias-insel-booster-display/?attribute_pa_sprache=franzosisch",
          "sku": "LO.II.F.ArchaziaDis.FR"
        },
        {
          "@type": "Product",
          "name": "Disney Lorcana - Archazia's Insel - Booster Display - deutsch",
          "url": "https://theuncommonshop.ch/product/disney-lorcana-archazias-insel-booster-display/?attribute_pa_sprache=deutsch",
          "sku": "LO.II.E.ArchaziaDis.DE"
        },
        {
          "@type": "Product",
          "name": "Disney Lorcana - Archazia's Insel - Booster Display - englisch",
          "url": "https://theuncommonshop.ch/product/disney-lorcana-archazias-insel-booster-display/?attribute_pa_sprache=englisch",
          "sku": "LO.I.C.ArchaziaDis.EN"
        }
      ]
    }
  ]
}
</script>
`;

describe("parseUncommonCardLang", () => {
  it("reads Sprache label", () => {
    expect(
      parseUncommonCardLang({ variationLabel: "Sprache: Englisch", productName: "X" })
    ).toBe("EN");
  });

  it("reads permalink attr", () => {
    expect(
      parseUncommonCardLang({
        permalink:
          "https://theuncommonshop.ch/product/x/?attribute_pa_sprache=deutsch",
      })
    ).toBe("DE");
  });
});

describe("resolveUncommonGtinFromHtml", () => {
  it("assigns ProductGroup gtin only to owner SKU", () => {
    const de = resolveUncommonGtinFromHtml(ARCHAZIA_GROUP_HTML, {
      sku: "LO.II.E.ArchaziaDis.DE",
      permalink:
        "https://theuncommonshop.ch/product/disney-lorcana-archazias-insel-booster-display/?attribute_pa_sprache=deutsch",
      variationLabel: "Sprache: Deutsch",
      productName: "Disney Lorcana – Archazia’s Insel – Booster Display — Sprache: Deutsch",
    });
    expect(de.ok).toBe(true);
    if (de.ok) {
      expect(de.resolved.gtin).toBe("4050368985590");
      expect(de.resolved.source).toBe("group_owner_gtin");
    }
  });

  it("rejects shared ProductGroup gtin for EN sibling", () => {
    const en = resolveUncommonGtinFromHtml(ARCHAZIA_GROUP_HTML, {
      sku: "LO.I.C.ArchaziaDis.EN",
      permalink:
        "https://theuncommonshop.ch/product/disney-lorcana-archazias-insel-booster-display/?attribute_pa_sprache=englisch",
      variationLabel: "Sprache: Englisch",
      productName: "Disney Lorcana – Archazia’s Insel – Booster Display — Sprache: Englisch",
    });
    expect(en.ok).toBe(false);
    if (!en.ok && en.ambiguity) {
      expect(en.ambiguity.reason).toBe("product_group_shared_gtin");
      expect(en.ambiguity.lang).toBe("EN");
      expect(en.ambiguity.groupGtin).toBe("4050368985590");
    }
  });
});

describe("matchWelGtinForUncommon", () => {
  it("fills EN from WEL when unique title+lang match", () => {
    const en = resolveUncommonGtinFromHtml(ARCHAZIA_GROUP_HTML, {
      sku: "LO.I.C.ArchaziaDis.EN",
      permalink:
        "https://theuncommonshop.ch/product/x/?attribute_pa_sprache=englisch",
      variationLabel: "Sprache: Englisch",
      productName: "Disney Lorcana – Archazia’s Insel – Booster Display — Sprache: Englisch",
    });
    expect(en.ok).toBe(false);
    if (en.ok || !en.ambiguity) throw new Error("expected ambiguity");

    const wel = buildWelGtinIndex([
      {
        gtin: "4050368985576",
        name: "Disney Lorcana: Archazia's Island - Booster Display (24 Booster) (EN)",
      },
      {
        gtin: "4050368985590",
        name: "Disney Lorcana: Archazias Insel - Booster Display (24 Booster) (DE)",
      },
    ]);
    const hit = matchWelGtinForUncommon(en.ambiguity, wel);
    expect(hit?.gtin).toBe("4050368985576");
    expect(hit?.source).toBe("wel_lang_match");
  });

  it("refuses WEL hit that equals shared group gtin", () => {
    const en = resolveUncommonGtinFromHtml(ARCHAZIA_GROUP_HTML, {
      sku: "LO.I.C.ArchaziaDis.EN",
      permalink:
        "https://theuncommonshop.ch/product/x/?attribute_pa_sprache=englisch",
      variationLabel: "Sprache: Englisch",
      productName: "Disney Lorcana – Archazia’s Insel – Booster Display — Sprache: Englisch",
    });
    if (en.ok || !en.ambiguity) throw new Error("expected ambiguity");
    const wel = buildWelGtinIndex([
      {
        gtin: "4050368985590",
        name: "Disney Lorcana: Archazia's Island - Booster Display (EN)",
      },
    ]);
    expect(matchWelGtinForUncommon(en.ambiguity, wel)).toBeNull();
  });
});

describe("isUncommonParentUrlWithoutLangAttr", () => {
  it("flags bare product URL", () => {
    expect(
      isUncommonParentUrlWithoutLangAttr(
        "https://theuncommonshop.ch/product/disney-lorcana-archazias-insel-booster-display/"
      )
    ).toBe(true);
  });

  it("allows sprache attr URL", () => {
    expect(
      isUncommonParentUrlWithoutLangAttr(
        "https://theuncommonshop.ch/product/x/?attribute_pa_sprache=englisch"
      )
    ).toBe(false);
  });
});
