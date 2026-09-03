/**
 * Incrementally import Ex Libris POC CSV rows into SupplierVariant.
 *
 * Usage:
 *   npx tsx scripts/import-exlibris-csv.ts
 *   npx tsx scripts/import-exlibris-csv.ts --csv=/app/.data/exlibris/exlibris_products.csv
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import { findScraperShop } from "@/app/lib/scraperShops";
import { upsertExlibrisCsvRow } from "@/app/lib/exlibrisScrape";
import { prisma } from "@/app/lib/prisma";

type ImportState = { importedGtins: string[]; updatedAt: string };

function csvArg(name: string, fallback: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=").slice(1).join("=") : fallback;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function loadState(statePath: string): ImportState {
  if (!fs.existsSync(statePath)) {
    return { importedGtins: [], updatedAt: new Date().toISOString() };
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8")) as ImportState;
  } catch {
    return { importedGtins: [], updatedAt: new Date().toISOString() };
  }
}

async function main() {
  const shop = findScraperShop("exl");
  if (!shop) throw new Error("EXL not configured in SCRAPER_SHOPS");

  const csvPath = csvArg("csv", path.join(process.cwd(), ".data/exlibris/exlibris_products.csv"));
  const statePath = csvArg("state", path.join(process.cwd(), ".data/exlibris-import-state.json"));
  if (!fs.existsSync(csvPath)) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "csv_missing", csvPath }));
    return;
  }

  const state = loadState(statePath);
  const imported = new Set(state.importedGtins);
  let lineNo = 0;
  let wrote = 0;
  let skipped = 0;
  let headers: string[] = [];

  const prismaAny = prisma as any;
  const existingRows = (await prismaAny.supplierVariant.findMany({
    where: { supplierVariantId: { startsWith: `${shop.key}_` } },
    select: {
      supplierVariantId: true,
      sourceImageUrl: true,
      hostedImageUrl: true,
      imageSyncStatus: true,
    },
  })) as Array<{
    supplierVariantId: string;
    sourceImageUrl: string | null;
    hostedImageUrl: string | null;
    imageSyncStatus: string | null;
  }>;
  const existingById = new Map(
    existingRows.map((row) => [
      row.supplierVariantId,
      {
        sourceImageUrl: row.sourceImageUrl ?? null,
        hostedImageUrl: row.hostedImageUrl ?? null,
        imageSyncStatus: row.imageSyncStatus ?? null,
      },
    ])
  );
  const imageSyncQueue = new Set<string>();

  const rl = readline.createInterface({ input: createReadStream(csvPath, { encoding: "utf8" }) });
  for await (const line of rl) {
    lineNo++;
    if (lineNo === 1) {
      headers = parseCsvLine(line);
      continue;
    }
    if (!line.trim()) continue;

    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    const gtin = String(row.gtin || "").trim();
    if (!gtin || imported.has(gtin)) {
      skipped++;
      continue;
    }

    const result = await upsertExlibrisCsvRow(shop, row, existingById, imageSyncQueue);
    if (result === "wrote") {
      wrote++;
      imported.add(gtin);
    } else {
      skipped++;
    }
  }

  state.importedGtins = [...imported];
  state.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const total = await prismaAny.supplierVariant.count({
    where: { supplierVariantId: { startsWith: `${shop.key}_` } },
  });

  console.log(
    JSON.stringify({
      ok: true,
      csvPath,
      linesRead: lineNo,
      wrote,
      skipped,
      exlRows: total,
      importedUnique: imported.size,
    })
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
