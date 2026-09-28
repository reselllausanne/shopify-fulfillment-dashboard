import { describe, expect, it } from "vitest";
import {
  BWZ_SHIP_BULKY_CHF,
  BWZ_SHIP_STANDARD_CHF,
  BWZ_SHIP_STANDARD_HEAVY_CHF,
  bwzShipChfFromManualNote,
  classifyBwzParcel,
  estimateBwzParcelFromCategory,
  isBwzUnshippableNote,
  parseBwzCm,
  parseBwzDescriptionParcel,
  parseBwzKg,
} from "@/app/lib/bwzParcel";

describe("parseBwz measures", () => {
  it("parses Swiss comma cm/kg", () => {
    expect(parseBwzCm("16,2 cm")).toBe(16.2);
    expect(parseBwzCm("72 cm")).toBe(72);
    expect(parseBwzKg("0,89 kg")).toBe(0.89);
    expect(parseBwzKg("3.7 kg")).toBe(3.7);
  });
});

describe("classifyBwzParcel", () => {
  it("balance bike fits standard PostPac", () => {
    const parcel = classifyBwzParcel({
      lengthCm: 16.2,
      widthCm: 33.7,
      heightCm: 73.1,
      weightKg: 3.7,
    });
    expect(parcel.parcelClass).toBe("standard");
    expect(parcel.shipChf).toBe(BWZ_SHIP_STANDARD_CHF);
    expect(parcel.longestCm).toBe(73.1);
  });

  it("workbench is Post bulky, not Walz flag", () => {
    const parcel = classifyBwzParcel({
      lengthCm: 72,
      widthCm: 44,
      heightCm: 93,
      weightKg: null,
    });
    expect(parcel.parcelClass).toBe("bulky");
    expect(parcel.shipChf).toBe(BWZ_SHIP_BULKY_CHF);
    expect(parcel.girthCm).toBe(93 + 2 * (72 + 44));
  });

  it("small toy stays standard", () => {
    const parcel = classifyBwzParcel({
      lengthCm: 26.2,
      widthCm: 9.55,
      heightCm: 28.2,
      weightKg: 0.89,
    });
    expect(parcel.parcelClass).toBe("standard");
    expect(parcel.shipChf).toBe(BWZ_SHIP_STANDARD_CHF);
  });

  it("standard over 10 kg uses heavy Post rate", () => {
    const parcel = classifyBwzParcel({
      lengthCm: 40,
      widthCm: 30,
      heightCm: 20,
      weightKg: 18,
    });
    expect(parcel.parcelClass).toBe("standard");
    expect(parcel.shipChf).toBe(BWZ_SHIP_STANDARD_HEAVY_CHF);
  });

  it("over 30 kg or past bulky girth is unshippable", () => {
    expect(
      classifyBwzParcel({ lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 31 }).parcelClass
    ).toBe("unshippable");
    expect(
      classifyBwzParcel({ lengthCm: 180, widthCm: 80, heightCm: 80, weightKg: 8 }).parcelClass
    ).toBe("unshippable");
  });

  it("missing dims stay unknown so feed keeps default ship", () => {
    const parcel = classifyBwzParcel({
      lengthCm: null,
      widthCm: 20,
      heightCm: 20,
      weightKg: null,
    });
    expect(parcel.parcelClass).toBe("unknown");
    expect(parcel.shipChf).toBeNull();
  });
});

describe("bwzShipChfFromManualNote", () => {
  it("reads stored ship", () => {
    const note = JSON.stringify({
      type: "baby_walz_scayle",
      parcelClass: "bulky",
      shipChf: 30,
    });
    expect(bwzShipChfFromManualNote(note)).toBe(30);
    expect(isBwzUnshippableNote(note)).toBe(false);
  });

  it("flags unshippable notes", () => {
    const note = JSON.stringify({ parcelClass: "unshippable", shipChf: null });
    expect(bwzShipChfFromManualNote(note)).toBeNull();
    expect(isBwzUnshippableNote(note)).toBe(true);
  });

  it("ignores notes without a parcel class", () => {
    expect(bwzShipChfFromManualNote(JSON.stringify({ bulkyOrLoad: false }))).toBeNull();
  });
});

describe("parseBwzDescriptionParcel", () => {
  const pramHtml = `<script id="__NUXT_DATA__">[1,"Klappmaß: 10 x 10 x 10 cm"]</script>
    <ul><li><strong>Belastbarkeit:</strong> 22 kg, Tragewanne bis 9 kg</li>
    <li><strong>Klappma&szlig;:</strong> 67,5(L) x 61,5(B) x 47,5(H) cm</li>
    <li><strong>Gewicht:</strong> Kinderwagen mit Tragewanne 15,6 kg, Babyschale 4,7 kg</li></ul>`;

  it("reads folded pram dims + weight from description (ignores Nuxt JSON + load limits)", () => {
    const parcel = parseBwzDescriptionParcel(pramHtml);
    expect(parcel?.source).toBe("description");
    expect(parcel?.lengthCm).toBe(67.5);
    expect(parcel?.weightKg).toBe(15.6);
    expect(parcel?.parcelClass).toBe("bulky");
    expect(parcel?.shipChf).toBe(BWZ_SHIP_BULKY_CHF);
  });

  it("prefers packaging dims over assembled Maße", () => {
    const html = `<li>Maße: 124 x 66 x 90 cm</li><li>Verpackungsmaße: 90 x 40 x 20 cm</li>`;
    const parcel = parseBwzDescriptionParcel(html);
    expect(parcel?.parcelClass).toBe("standard");
    expect(parcel?.shipChf).toBe(BWZ_SHIP_STANDARD_CHF);
  });

  it("assembled furniture dims fall back to bulky, not unshippable", () => {
    const parcel = parseBwzDescriptionParcel(`<li>Maße: 124 x 66 x 90 cm</li>`);
    expect(parcel?.parcelClass).toBe("bulky");
  });

  it("returns null without dims lines", () => {
    expect(parseBwzDescriptionParcel(`<li>Material: 100% Baumwolle</li>`)).toBeNull();
  });
});

describe("estimateBwzParcelFromCategory", () => {
  it("big-item names get bulky ship", () => {
    const p = estimateBwzParcelFromCategory({ name: "Laufrad Classic", productType: "Spielzeug", buyChf: 60 });
    expect(p?.shipChf).toBe(BWZ_SHIP_BULKY_CHF);
    expect(p?.source).toBe("category");
  });

  it("accessories of big items stay on default", () => {
    expect(
      estimateBwzParcelFromCategory({
        name: "Jersey-Spannbetttuch für Beistellbett",
        productType: "Wohnen",
        buyChf: 25,
      })
    ).toBeNull();
    expect(
      estimateBwzParcelFromCategory({ name: "Rutschfeste Socken", productType: "Bekleidung", buyChf: 8 })
    ).toBeNull();
  });

  it("pricey pram / home / car-seat category without dims", () => {
    expect(
      estimateBwzParcelFromCategory({ name: "Fame Travel-Set", productType: "Kinderwagen", buyChf: 1400 })?.shipChf
    ).toBe(BWZ_SHIP_BULKY_CHF);
    expect(
      estimateBwzParcelFromCategory({ name: "Pebble 360", productType: "Kindersitze", buyChf: 300 })?.shipChf
    ).toBe(BWZ_SHIP_STANDARD_HEAVY_CHF);
  });

  it("accessory named \"für <big item>\" is not bulky", () => {
    expect(
      estimateBwzParcelFromCategory({
        name: "Lammfell-Handwärmer Big Double für Kinderwagen",
        productType: "Kinderwagen",
        buyChf: 68,
      })
    ).toBeNull();
    expect(
      estimateBwzParcelFromCategory({ name: "Buggy für Zwillinge", productType: "Kinderwagen", buyChf: 300 })?.shipChf
    ).toBe(BWZ_SHIP_BULKY_CHF);
  });

  it("other expensive unknown → standard; cheap unknown → null", () => {
    expect(
      estimateBwzParcelFromCategory({ name: "Babyphone Video", productType: "Pflege", buyChf: 180 })?.shipChf
    ).toBe(BWZ_SHIP_STANDARD_CHF);
    expect(estimateBwzParcelFromCategory({ name: "Body", productType: "Bekleidung", buyChf: 20 })).toBeNull();
  });
});
