#!/usr/bin/env npx tsx
/**
 * Temporary ops: full Galaxus stock +/or price push, omitting WEL card SKUs
 * (see galaxus/exports/welFeedOmit.ts). Never upload WEL-only — Stock/Price
 * files are full-catalog replacements.
 *
 * Env:
 *   PUSH_MODE=both|stock|price   (default both)
 *   DRY_RUN=1                    build + audit only, no SFTP
 *   GALAXUS_FEED_WORKER_ORIGIN   used only to build export URLs (in-process GET)
 *
 * Run on feed worker (SFTP + heap):
 *   docker compose exec -T -e PUSH_MODE=both worker-galaxus-feed \
 *     sh -c 'NODE_OPTIONS=--max-old-space-size=8192 npx tsx scripts/galaxus-push-omit-wel-cards.ts'
 */
import "dotenv/config";
import { randomUUID, createHash } from "crypto";
import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_ASSORTMENT_FILE,
  GALAXUS_PROVIDER_NAME,
  GALAXUS_SFTP_FEED_UPLOAD_TIMEOUT_MS,
  GALAXUS_SFTP_FEEDS_DIR,
  GALAXUS_SFTP_HOST,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  assertSftpConfig,
} from "@/galaxus/edi/config";
import { uploadTempThenRename, withSftp } from "@/galaxus/edi/sftpClient";
import { filterCsvByProviderKeys } from "@/galaxus/exports/feedValidation";
import { loadWelCardOmitProviderKeys } from "@/galaxus/exports/welFeedOmit";
import { runGalaxusExportGET } from "@/galaxus/ops/internalExportGet";

const ORIGIN = process.env.GALAXUS_FEED_WORKER_ORIGIN ?? "http://127.0.0.1:3000";
const DRY = ["1", "true", "yes"].includes(String(process.env.DRY_RUN ?? "").toLowerCase());

function normalizeProviderName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "digitecgalaxus";
}

function buildFeedFilename(type: "price" | "stock"): string {
  const safeProvider = normalizeProviderName(GALAXUS_PROVIDER_NAME || "digitecgalaxus");
  const assortment = (GALAXUS_ASSORTMENT_FILE || "price").toLowerCase();
  const suffix = assortment === type ? "_assortment" : "";
  if (type === "price") return `PriceData_${safeProvider}${suffix}.csv`;
  return `StockData_${safeProvider}${suffix}.csv`;
}

function countCsvRows(csv: string): number {
  if (!csv) return 0;
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

async function exportCsv(path: string): Promise<string> {
  const url = `${ORIGIN}${path}`;
  const res = await runGalaxusExportGET(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Export failed ${path}: ${res.status} ${body.slice(0, 400)}`);
  }
  return res.text();
}

async function invalidateSnapshot() {
  const updated = await (prisma as any).galaxusFeedSnapshotMeta.updateMany({
    where: { id: "default" },
    data: { rebuiltAt: null, stockRowCount: 0, offerRowCount: 0 },
  });
  console.info("[omit-push] snapshot invalidated", updated);
}

async function recordRun(params: {
  scope: string;
  success: boolean;
  counts: Record<string, number | null>;
  omitted: number;
  error?: string;
  runId: string;
}) {
  const startedAt = new Date();
  await (prisma as any).galaxusFeedRun.create({
    data: {
      runId: params.runId,
      scope: params.scope,
      triggerSource: "manual",
      startedAt,
      finishedAt: new Date(),
      success: params.success,
      errorMessage: params.error ?? null,
      manifestIds: [],
      countsJson: { ...params.counts, omittedWelCardSkus: params.omitted },
    },
  });
}

async function uploadOne(params: {
  scope: "stock" | "price";
  csv: string;
  omit: Set<string>;
}) {
  const filtered = filterCsvByProviderKeys(params.csv, params.omit);
  const count = countCsvRows(filtered.filteredCsv);
  const name = buildFeedFilename(params.scope === "price" ? "price" : "stock");
  const runId = randomUUID();
  console.info("[omit-push]", params.scope, {
    before: countCsvRows(params.csv),
    after: count,
    omitted: filtered.omittedRows,
    file: name,
    sha16: createHash("sha256").update(filtered.filteredCsv).digest("hex").slice(0, 16),
    dry: DRY,
  });
  if (count <= 0) throw new Error(`Refusing empty ${params.scope} feed`);
  if (DRY) {
    await recordRun({
      scope: params.scope,
      success: true,
      counts: params.scope === "stock" ? { stock: count } : { offer: count },
      omitted: filtered.omittedRows,
      runId,
    });
    return { runId, count, omitted: filtered.omittedRows };
  }
  assertSftpConfig();
  await withSftp(
    {
      host: GALAXUS_SFTP_HOST,
      port: GALAXUS_SFTP_PORT,
      username: GALAXUS_SFTP_USER,
      password: GALAXUS_SFTP_PASSWORD,
    },
    async (client) => {
      await uploadTempThenRename(client, GALAXUS_SFTP_FEEDS_DIR, name, filtered.filteredCsv);
    },
    { timeoutMs: GALAXUS_SFTP_FEED_UPLOAD_TIMEOUT_MS }
  );
  await recordRun({
    scope: params.scope,
    success: true,
    counts: params.scope === "stock" ? { stock: count } : { offer: count },
    omitted: filtered.omittedRows,
    runId,
  });
  return { runId, count, omitted: filtered.omittedRows };
}

async function main() {
  const omit = await loadWelCardOmitProviderKeys();
  console.info("[omit-push] omit keys", omit.size);
  const mode = String(process.env.PUSH_MODE ?? "both").toLowerCase();

  if (mode !== "price") {
    await invalidateSnapshot();
  }

  let stock: { runId: string; count: number; omitted: number } | null = null;
  let price: { runId: string; count: number; omitted: number } | null = null;

  if (mode === "both" || mode === "stock") {
    console.info("[omit-push] exporting live stock…");
    const stockCsv = await exportCsv("/api/galaxus/export/stock?all=1");
    stock = await uploadOne({ scope: "stock", csv: stockCsv, omit });
  }

  if (mode === "both" || mode === "price") {
    console.info("[omit-push] exporting live offer…");
    const offerCsv = await exportCsv("/api/galaxus/export/offer?all=1");
    price = await uploadOne({ scope: "price", csv: offerCsv, omit });
  }

  console.info("[omit-push] DONE", { stock, price, omitKeys: omit.size, mode });
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[omit-push] FAIL", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
