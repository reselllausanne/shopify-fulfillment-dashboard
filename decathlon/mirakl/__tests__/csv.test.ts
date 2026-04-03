import { describe, expect, it } from "vitest";
import { buildOf01WithProductsCsv, buildPri01Csv, buildSto01Csv, OF01_WITH_PRODUCTS_HEADERS } from "../csv";

describe("mirakl csv builders", () => {
  it("builds STO01 CSV with semicolons and quotes", () => {
    const { csv } = buildSto01Csv([
      { offerSku: "PK_123", quantity: 5, warehouseCode: "WH-01", updateDelete: "UPDATE" },
    ]);
    const [header, row] = csv.split("\n");
    expect(header).toBe("\"offer-sku\";\"quantity\";\"warehouse-code\";\"update-delete\"");
    expect(row).toBe("\"PK_123\";\"5\";\"WH-01\";\"UPDATE\"");
  });

  it("builds PRI01 CSV with blank discount fields", () => {
    const { csv } = buildPri01Csv([{ offerSku: "PK_123", price: "119.90" }]);
    const [header, row] = csv.split("\n");
    expect(header).toBe(
      "\"offer-sku\";\"price\";\"discount-price\";\"discount-start-date\";\"discount-end-date\""
    );
    expect(row).toBe("\"PK_123\";\"119.90\";\"\";\"\";\"\"");
  });

  it("builds OF01 operator-format CSV with product + offer headers", () => {
    const { csv } = buildOf01WithProductsCsv([
      {
        "Catégorie": "Shoes",
        "Product Identifier": "PK_123",
        "codes EAN": "1234567890123",
        sku: "PK_123",
        "product-id": "1234567890123",
        "product-id-type": "EAN",
        price: "199.00",
        quantity: 2,
        state: "11",
        "logistic-class": "A",
      },
    ]);
    const [header, row] = csv.split("\n");
    const expectedHeader = OF01_WITH_PRODUCTS_HEADERS.map((col) => `"${col}"`).join(";");
    expect(header).toBe(expectedHeader);
    const values = row.split(";").map((value) => value.replace(/^\"|\"$/g, ""));
    expect(values[OF01_WITH_PRODUCTS_HEADERS.indexOf("Catégorie")]).toBe("Shoes");
    expect(values[OF01_WITH_PRODUCTS_HEADERS.indexOf("Product Identifier")]).toBe("PK_123");
    expect(values[OF01_WITH_PRODUCTS_HEADERS.indexOf("sku")]).toBe("PK_123");
    expect(values[OF01_WITH_PRODUCTS_HEADERS.indexOf("logistic-class")]).toBe("A");
  });
});
