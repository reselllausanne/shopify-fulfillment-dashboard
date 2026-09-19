import { describe, expect, it } from "vitest";
import { decideVenPublishedQty, parseVenStock } from "./venQty";

describe("venQty", () => {
  it("Sofort + N=4 → halfCeil→2", () => {
    const d = decideVenPublishedQty(
      parseVenStock({ schemaInStock: true, sofortVerfuegbar: true, stockQuantityNumber: 4 })
    );
    expect(d.sourceQty).toBe(4);
    expect(d.proposedQty).toBe(2);
  });

  it("Sofort + N=1 → 1", () => {
    const d = decideVenPublishedQty(
      parseVenStock({ schemaInStock: true, sofortVerfuegbar: true, stockQuantityNumber: 1 })
    );
    expect(d.proposedQty).toBe(1);
  });

  it("Sofort but no exact qty → 0, never invent 100 or 1", () => {
    const d = decideVenPublishedQty(
      parseVenStock({ schemaInStock: true, sofortVerfuegbar: true, stockQuantityNumber: null })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("sofort_but_no_exact_qty");
  });

  it("Schema OutOfStock → 0", () => {
    const d = decideVenPublishedQty(
      parseVenStock({ schemaInStock: false, sofortVerfuegbar: false })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("schema_not_instock");
  });

  it("Liefertermin unbekannt → 0", () => {
    const d = decideVenPublishedQty(parseVenStock({ liefertermUnbekannt: true }));
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("liefertermin_unbekannt");
  });

  it("Not Sofort → 0", () => {
    const d = decideVenPublishedQty(
      parseVenStock({ schemaInStock: true, sofortVerfuegbar: false })
    );
    expect(d.proposedQty).toBe(0);
    expect(d.reason).toBe("not_sofort_verfuegbar");
  });
});
