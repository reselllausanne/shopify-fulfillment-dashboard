import { describe, expect, it } from "vitest";
import {
  BWZ_SHIP_BULKY_CHF,
  BWZ_SHIP_STANDARD_CHF,
  BWZ_SHIP_STANDARD_HEAVY_CHF,
  bwzShipChfFromManualNote,
  classifyBwzParcel,
  isBwzUnshippableNote,
  parseBwzCm,
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
