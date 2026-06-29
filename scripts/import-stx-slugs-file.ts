/**
 * Safe bulk queue import from a newline-delimited slug/URL file.
 * Existing slugs keep their status (PENDING / IMPORTED / ERROR).
 *
 * Usage: npx tsx scripts/import-stx-slugs-file.ts /path/to/slugs.txt
 */
import "dotenv/config";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { prisma } from "../app/lib/prisma";
import {
  bulkInsertStxImportSlugs,
  dedupeSlugRows,
  getStxImportSlugCounts,
} from "../galaxus/stx/importSlugsBulk";

const FILE_CHUNK_LINES = 10_000;

async function* readFileInChunks(filePath: string): AsyncGenerator<string[], void, unknown> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let batch: string[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    batch.push(trimmed);
    if (batch.length >= FILE_CHUNK_LINES) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) yield batch;
}

async function main() {
  const filePath = process.argv[2]?.trim();
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-stx-slugs-file.ts /path/to/slugs.txt");
    process.exit(1);
  }

  const before = await getStxImportSlugCounts();
  console.log("[stx-import-file] counts before:", before);

  let linesReceived = 0;
  let uniqueSlugsProcessed = 0;
  let insertedNew = 0;
  let chunkIndex = 0;

  const chunks = readFileInChunks(filePath);
  for await (const lines of chunks) {
    chunkIndex += 1;
    linesReceived += lines.length;
    const rows = dedupeSlugRows(lines);
    uniqueSlugsProcessed += rows.length;
    const inserted = await bulkInsertStxImportSlugs(rows);
    insertedNew += inserted;
    const skipped = rows.length - inserted;
    console.log(
      `[stx-import-file] chunk ${chunkIndex}: lines=${lines.length} unique=${rows.length} inserted=${inserted} skippedExisting=${skipped} totalInserted=${insertedNew}`
    );
  }

  const after = await getStxImportSlugCounts();
  console.log(
    JSON.stringify(
      {
        ok: true,
        filePath,
        linesReceived,
        uniqueSlugsProcessed,
        insertedNew,
        skippedExisting: Math.max(0, uniqueSlugsProcessed - insertedNew),
        countsBefore: before,
        countsAfter: after,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[stx-import-file] failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
