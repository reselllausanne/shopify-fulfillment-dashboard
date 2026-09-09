import { createWriteStream } from "fs";
import { createHash } from "crypto";

type CsvValue = string | number | boolean | null | undefined;

function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Rows per intermediate join — keeps each chunk under V8's max string length. */
const CSV_BUFFER_CHUNK_ROWS = 10_000;

/**
 * Build a CSV as a Buffer by joining only small row batches.
 * Master/specs catalogs (~270k / ~1.2M rows) exceed V8's max string length when
 * `lines.join("\n")` runs on the full file — that throws `RangeError: Invalid string length`.
 */
export function toCsvBuffer(headers: string[], rows: Array<Record<string, CsvValue>>): Buffer {
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from(`${headers.map(escapeCsvValue).join(",")}\n`, "utf8"));

  for (let offset = 0; offset < rows.length; offset += CSV_BUFFER_CHUNK_ROWS) {
    const slice = rows.slice(offset, offset + CSV_BUFFER_CHUNK_ROWS);
    const body = slice
      .map((row) => headers.map((header) => escapeCsvValue(row[header])).join(","))
      .join("\n");
    const more = offset + CSV_BUFFER_CHUNK_ROWS < rows.length;
    chunks.push(Buffer.from(more ? `${body}\n` : body, "utf8"));
  }

  return Buffer.concat(chunks);
}

export function toCsv(headers: string[], rows: Array<Record<string, CsvValue>>): string {
  // Small exports only. Large catalogs must use `toCsvBuffer` + upload the Buffer.
  return toCsvBuffer(headers, rows).toString("utf8");
}

export type StreamedCsvResult = {
  size: number;
  sha256: string;
  /** ProviderKey supplier prefixes (first `_` segment) across all rows. */
  supplierKeys: string[];
};

/**
 * Stream a CSV to a file on disk instead of materializing one Buffer in memory.
 *
 * Byte-for-byte identical to `toCsvBuffer(headers, rows)` — same header line, same
 * per-row escaping, same `\n` separators, no trailing newline (except the
 * header-only case, which also matches `toCsvBuffer`). The returned `sha256` is the
 * hash of those exact bytes, so it equals `sha256(toCsvBuffer(...))`.
 *
 * Master/specs catalogs serialize to 800MB+; holding that Buffer beside the row
 * arrays is what pushes the feed worker to OOM. Writing straight to disk keeps peak
 * memory to a single chunk (~10k rows) regardless of catalog size, and the file is
 * then stream-uploaded to SFTP without ever loading it back into RAM.
 */
export async function streamCsvToFile(
  headers: string[],
  rows: Array<Record<string, CsvValue>>,
  filePath: string
): Promise<StreamedCsvResult> {
  const hash = createHash("sha256");
  const ws = createWriteStream(filePath);
  const suppliers = new Set<string>();
  let size = 0;

  const writeBuf = (buf: Buffer): Promise<void> => {
    hash.update(buf);
    size += buf.length;
    return new Promise((resolve, reject) => {
      ws.write(buf, (err) => (err ? reject(err) : resolve()));
    });
  };

  try {
    // Header line — mirrors toCsvBuffer's `${headers...}\n` exactly.
    await writeBuf(Buffer.from(`${headers.map(escapeCsvValue).join(",")}\n`, "utf8"));

    for (let offset = 0; offset < rows.length; offset += CSV_BUFFER_CHUNK_ROWS) {
      const slice = rows.slice(offset, offset + CSV_BUFFER_CHUNK_ROWS);
      const body = slice
        .map((row) => headers.map((header) => escapeCsvValue(row[header])).join(","))
        .join("\n");
      const more = offset + CSV_BUFFER_CHUNK_ROWS < rows.length;
      // Same chunk boundary + trailing-`\n`-only-when-more rule as toCsvBuffer.
      await writeBuf(Buffer.from(more ? `${body}\n` : body, "utf8"));
      for (const row of slice) {
        const providerKey = String(row.ProviderKey ?? "").trim();
        const supplierKey = providerKey.split("_")[0]?.trim();
        if (supplierKey) suppliers.add(supplierKey);
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      ws.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
  }

  return {
    size,
    sha256: hash.digest("hex"),
    supplierKeys: Array.from(suppliers).sort(),
  };
}
