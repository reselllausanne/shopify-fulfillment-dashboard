import { describe, expect, it } from "vitest";
import { classifyReicheltGalaxusKind } from "@/app/lib/reicheltGalaxusCategories";
import { galaxusCategoryPathForKind } from "@/galaxus/exports/galaxusCategoryPaths";
import {
  buildLightingSpecRows,
  parseLightingAttrsFromTitle,
} from "@/galaxus/exports/lightingSpecs";
import { resolveGalaxusDescription, resolveGalaxusProductCategoryPath } from "@/galaxus/exports/productClassification";
import { isJunkReicheltBreadcrumb } from "@/app/lib/reicheltClient";

describe("reichelt Müller Licht lighting classification", () => {
  it("maps LED tubes to light_bulb / Leuchtmittel not Transistor", () => {
    const title = "MÜLLER LICHT Tube LED T8, 16,5 W, 2000 lm, 6500 K, 1200 mm, verre";
    const kind = classifyReicheltGalaxusKind({ title });
    expect(kind).toBe("light_bulb");
    expect(galaxusCategoryPathForKind(kind!, "rei")).toContain("Leuchtmittel");
    expect(resolveGalaxusProductCategoryPath({ title, supplierKey: "rei", brand: "MÜLLER LICHT" })).toContain(
      "Leuchtmittel"
    );
  });

  it("maps camping GLEN to camping_lamp", () => {
    expect(
      classifyReicheltGalaxusKind({
        title: "MÜLLER LICHT Lumière extérieure LED GLEN, dimmable, CCT, batterie, IP44, beig",
      })
    ).toBe("camping_lamp");
    expect(
      classifyReicheltGalaxusKind({
        title: "MÜLLER LICHT LED-Akku-Campingleuchte GLEN, 2 W, 150 lm",
      })
    ).toBe("camping_lamp");
    expect(
      resolveGalaxusProductCategoryPath({
        title: "MÜLLER LICHT Lumière extérieure LED GLEN, dimmable, CCT, batterie, IP44, beig",
        supplierKey: "rei",
        brand: "MÜLLER LICHT",
      })
    ).toBe("Sport > Outdoor > Lampen + Leuchten > Campinglampe");
  });

  it("maps motion detectors to motion_sensor", () => {
    expect(classifyReicheltGalaxusKind({ title: "MÜLLER LICHT Détecteur de mouvement PIR" })).toBe(
      "motion_sensor"
    );
  });

  it("does not describe lighting as sneakers", () => {
    const desc = resolveGalaxusDescription({
      title: "MÜLLER LICHT Tube LED T8, 16,5 W, 2000 lm, 6500 K, 1200 mm",
      brand: "MÜLLER LICHT",
      supplierKey: "rei",
    });
    expect(desc.toLowerCase()).not.toContain("sneaker");
    expect(desc.toLowerCase()).toMatch(/led|lighting|bulb/);
  });
});

describe("lightingSpecs from titles", () => {
  it("parses FR mangled kelvin + length", () => {
    const attrs = parseLightingAttrsFromTitle(
      "MÜLLER LICHT Tube LED T8, 16,5 W, 2000 lm, 3 6500 K, 12000 mm, verre"
    );
    expect(attrs.watts).toBe("16.5");
    expect(attrs.kelvin).toBe("6500");
    expect(attrs.lengthMm).toBe("1200");
    expect(attrs.lengthCm).toBe("120");
    expect(attrs.lumens).toBe("2000");
    expect(attrs.tubeType).toBe("T8");
  });

  it("emits Galaxus spec rows", () => {
    const rows = buildLightingSpecRows({
      providerKey: "REI_4018412327116",
      title: "MÜLLER LICHT LED-Röhre T8, 15,6 W, 2500 lm, 3000 K, 1200 mm, Glas",
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.SpecificationKey, r.SpecificationValue]));
    expect(byKey["Power consumption"]).toBe("15.6 W");
    expect(byKey["Colour temperature"]).toBe("3000 K");
    expect(byKey["Length (cm)"]).toBe("120");
    expect(byKey["Luminous flux"]).toBe("2500 lm");
    expect(byKey["Bulb type"]).toBe("T8");
  });
});

describe("isJunkReicheltBreadcrumb", () => {
  it("filters login and vat junk", () => {
    expect(isJunkReicheltBreadcrumb("Veuillez vous connecter !")).toBe(true);
    expect(isJunkReicheltBreadcrumb("avec 8.1% TVA hors frais d’expédition")).toBe(true);
    expect(isJunkReicheltBreadcrumb("Culot G13, tubes LED T8")).toBe(false);
  });
});
