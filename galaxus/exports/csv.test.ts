import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { streamCsvToFile, toCsvBuffer } from "@/galaxus/exports/csv";

/**
 * The streaming writer must be a drop-in for toCsvBuffer: the file it writes has to
 * be byte-for-byte identical to the Buffer, or the Galaxus feed content would change.
 */
describe("streamCsvToFile matches toCsvBuffer byte-for-byte", () => {
  const headers = ["ProviderKey", "Gtin", "ProductTitle_de", "LongDescription_de"];

  const cases: Record<string, Array<Record<string, string>>> = {
    empty: [],
    single: [{ ProviderKey: "STX_1", Gtin: "1", ProductTitle_de: "A", LongDescription_de: "d" }],
    escaping: [
      // comma, quote, newline, CR — every branch of escapeCsvValue
      { ProviderKey: "WEL_2", Gtin: "2", ProductTitle_de: 'Title, with "quotes"', LongDescription_de: "line1\nline2\rline3" },
      { ProviderKey: "REI_3", Gtin: "", ProductTitle_de: "", LongDescription_de: "plain" },
    ],
    unicode: [
      { ProviderKey: "BWZ_4", Gtin: "4", ProductTitle_de: "Éclairage — ™ ® ©", LongDescription_de: "Größe 42½ · näher" },
    ],
    // Larger than CSV_BUFFER_CHUNK_ROWS (10_000) to exercise chunk boundaries.
    multiChunk: Array.from({ length: 25_003 }, (_, i) => ({
      ProviderKey: `STX_${i}`,
      Gtin: String(1_000_000 + i),
      ProductTitle_de: i % 7 === 0 ? `weird, "${i}"\n` : `Title ${i}`,
      LongDescription_de: `desc ${i}`,
    })),
  };

  it.each(Object.keys(cases))("case=%s", async (name) => {
    const rows = cases[name];
    const expected = toCsvBuffer(headers, rows);

    const dir = mkdtempSync(join(tmpdir(), "csv-stream-"));
    const filePath = join(dir, "out.csv");
    try {
      const result = await streamCsvToFile(headers, rows, filePath);
      const actual = readFileSync(filePath);

      expect(actual.equals(expected)).toBe(true);
      expect(result.size).toBe(expected.length);
      expect(result.sha256).toBe(createHash("sha256").update(expected).digest("hex"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("derives supplier keys from ProviderKey prefixes", async () => {
    const rows = [
      { ProviderKey: "STX_1", Gtin: "1", ProductTitle_de: "a", LongDescription_de: "" },
      { ProviderKey: "WEL_2", Gtin: "2", ProductTitle_de: "b", LongDescription_de: "" },
      { ProviderKey: "STX_9", Gtin: "9", ProductTitle_de: "c", LongDescription_de: "" },
    ];
    const dir = mkdtempSync(join(tmpdir(), "csv-stream-"));
    const filePath = join(dir, "out.csv");
    try {
      const result = await streamCsvToFile(headers, rows, filePath);
      expect(result.supplierKeys).toEqual(["STX", "WEL"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
