import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openCsvWriter, streamCsvFromIterable } from "@/galaxus/exports/csvStream";
import { toCsv } from "@/galaxus/exports/csv";

const HEADERS = ["ProviderKey", "Gtin", "ProductTitle_de"] as const;

const created: string[] = [];
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "galaxus-csv-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("csvStream", () => {
  it("matches toCsv output byte-for-byte for simple rows", async () => {
    const rows = [
      { ProviderKey: "STX_A", Gtin: "0193154456202", ProductTitle_de: "Nike" },
      { ProviderKey: "STX_B", Gtin: "0193154456219", ProductTitle_de: "Adidas" },
    ];
    const path = join(scratchDir(), "master.csv");
    const writer = await openCsvWriter(path, [...HEADERS]);
    await writer.writeMany(rows);
    const info = await writer.close();

    expect(info.rowCount).toBe(2);
    const streamed = readFileSync(path, "utf8");
    expect(streamed).toBe(toCsv([...HEADERS], rows));
  });

  it("escapes commas / quotes / newlines identically to legacy writer", async () => {
    const rows = [
      { ProviderKey: "STX_C", Gtin: "0193154456226", ProductTitle_de: "Air Max, low" },
      { ProviderKey: "STX_D", Gtin: "0193154456233", ProductTitle_de: 'Say "Hi"' },
      { ProviderKey: "STX_E", Gtin: "0193154456240", ProductTitle_de: "line1\nline2" },
    ];
    const path = join(scratchDir(), "master.csv");
    await streamCsvFromIterable({
      path,
      headers: [...HEADERS],
      rows: (async function* () {
        for (const row of rows) yield row;
      })(),
    });

    const streamed = readFileSync(path, "utf8");
    expect(streamed).toBe(toCsv([...HEADERS], rows));
  });

  it("atomic rename: no final file when aborted", async () => {
    const path = join(scratchDir(), "master.csv");
    const writer = await openCsvWriter(path, [...HEADERS]);
    await writer.write({ ProviderKey: "STX_A", Gtin: "0193154456202", ProductTitle_de: "x" });
    await writer.abort();

    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("handles empty spec-style rows (multiple key/value per providerKey)", async () => {
    const rows = [
      { ProviderKey: "STX_A", SpecificationKey: "Brand", SpecificationValue: "Nike" },
      { ProviderKey: "STX_A", SpecificationKey: "Color", SpecificationValue: "Black" },
      { ProviderKey: "STX_A", SpecificationKey: "Shoe size (EU)", SpecificationValue: "42" },
    ];
    const specHeaders = ["ProviderKey", "SpecificationKey", "SpecificationValue"];
    const path = join(scratchDir(), "specs.csv");
    const writer = await openCsvWriter(path, specHeaders);
    for (const row of rows) await writer.write(row);
    const info = await writer.close();

    expect(info.rowCount).toBe(3);
    expect(readFileSync(path, "utf8")).toBe(toCsv(specHeaders, rows));
  });
});
