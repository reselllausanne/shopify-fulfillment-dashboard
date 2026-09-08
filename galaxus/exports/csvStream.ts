import { createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import { rename, unlink } from "fs/promises";
import { dirname } from "path";
import { Readable } from "stream";

type CsvValue = string | number | boolean | null | undefined;
export type CsvRow = Record<string, CsvValue>;

/**
 * Escape a single CSV cell — RFC 4180: wrap in quotes if it contains
 * comma / quote / newline; double any embedded quotes.
 */
function escapeCsvValue(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function formatCsvLine(headers: readonly string[], row: CsvRow): string {
  const cells = new Array<string>(headers.length);
  for (let i = 0; i < headers.length; i += 1) {
    cells[i] = escapeCsvValue(row[headers[i]]);
  }
  return cells.join(",");
}

/**
 * Streaming CSV writer — never holds more than one row in memory.
 *
 * Usage:
 *   const writer = await openCsvWriter("/tmp/master.csv", HEADERS);
 *   for await (const row of source) await writer.write(row);
 *   const { path, rowCount, byteSize } = await writer.close();
 *
 * Writes to `<path>.tmp` and atomic-renames on close so partial files never
 * end up at the final path if the process dies mid-write.
 */
export type CsvWriter = {
  readonly path: string;
  readonly headers: readonly string[];
  write(row: CsvRow): Promise<void>;
  writeMany(rows: CsvRow[]): Promise<void>;
  /** rowCount = data rows written, not counting the header line. */
  close(): Promise<{ path: string; rowCount: number; byteSize: number }>;
  abort(): Promise<void>;
};

export async function openCsvWriter(
  path: string,
  headers: readonly string[]
): Promise<CsvWriter> {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmpPath = `${path}.tmp`;
  if (existsSync(tmpPath)) {
    await unlink(tmpPath).catch(() => undefined);
  }

  const stream = createWriteStream(tmpPath, { flags: "w", encoding: "utf8" });
  let rowCount = 0;
  let closed = false;

  const writeString = (chunk: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (stream.write(chunk, "utf8")) {
        resolve();
        return;
      }
      stream.once("drain", resolve);
      stream.once("error", reject);
    });

  await writeString(headers.map(escapeCsvValue).join(","));

  return {
    path,
    headers,
    async write(row) {
      if (closed) throw new Error("csvStream: write after close");
      await writeString("\n" + formatCsvLine(headers, row));
      rowCount += 1;
    },
    async writeMany(rows) {
      if (closed) throw new Error("csvStream: writeMany after close");
      if (rows.length === 0) return;
      // Concat one batch into a single write to reduce syscalls without
      // holding the whole file in memory.
      let chunk = "";
      for (const row of rows) chunk += "\n" + formatCsvLine(headers, row);
      await writeString(chunk);
      rowCount += rows.length;
    },
    async close() {
      if (closed) {
        return {
          path,
          rowCount,
          byteSize: existsSync(path) ? statSync(path).size : 0,
        };
      }
      closed = true;
      await new Promise<void>((resolve, reject) => {
        stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
      await rename(tmpPath, path);
      const byteSize = statSync(path).size;
      return { path, rowCount, byteSize };
    },
    async abort() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => stream.end(() => resolve()));
      await unlink(tmpPath).catch(() => undefined);
    },
  };
}

/**
 * Stream an async iterable of rows through the CSV writer. Handy for piping
 * a Prisma cursor / async generator with no per-row awaits at the call site.
 */
export async function streamCsvFromIterable(params: {
  path: string;
  headers: readonly string[];
  rows: AsyncIterable<CsvRow>;
}): Promise<{ path: string; rowCount: number; byteSize: number }> {
  const writer = await openCsvWriter(params.path, params.headers);
  try {
    for await (const row of params.rows) {
      await writer.write(row);
    }
    return await writer.close();
  } catch (err) {
    await writer.abort();
    throw err;
  }
}

/** Small helper: CSV as a Readable stream from an in-memory iterable (tests). */
export function csvRowsAsReadable(
  headers: readonly string[],
  rows: Iterable<CsvRow>
): Readable {
  async function* generate() {
    yield headers.map(escapeCsvValue).join(",");
    for (const row of rows) yield "\n" + formatCsvLine(headers, row);
  }
  return Readable.from(generate(), { encoding: "utf8" });
}

export { escapeCsvValue, formatCsvLine };
