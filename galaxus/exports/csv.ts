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
