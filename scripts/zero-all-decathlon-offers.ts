/**
 * Zero ALL Decathlon Mirakl offers (STX + everything else) and disable stock/price cron.
 * Used with isDecathlonSalesPaused() so sync cannot re-list.
 *
 * Usage: npx tsx scripts/zero-all-decathlon-offers.ts
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { buildMiraklClient } from "@/decathlon/mirakl/client";
import { buildPri01Csv, buildSto01Csv } from "@/decathlon/mirakl/csv";
import { DECATHLON_MIRAKL_WAREHOUSE_CODE } from "@/decathlon/mirakl/config";

const BATCH = 2000;
const WH = DECATHLON_MIRAKL_WAREHOUSE_CODE;
const SLEEP_MS = 15_000;
const START_BATCH = Math.max(1, Number.parseInt(process.env.ZERO_BATCH_START ?? "1", 10) || 1);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withPrismaRetry<T>(fn: () => Promise<T>, label: string, attempt = 1): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const code = String(err?.code ?? "");
    const msg = String(err?.message ?? err);
    const reconnectable =
      code === "P1017" ||
      code === "P2024" ||
      /closed the connection|Can't reach database|Connection reset|connection pool/i.test(msg);
    if (reconnectable && attempt <= 5) {
      const wait = 2000 * attempt;
      console.log(`[zero-all-decathlon] prisma ${label} fail — reconnect wait ${wait}ms #${attempt}`);
      await sleep(wait);
      try {
        await prisma.$connect();
      } catch {
        /* ignore */
      }
      return withPrismaRetry(fn, label, attempt + 1);
    }
    throw err;
  }
}

async function importWithRetry(
  kind: "STO01" | "PRI01",
  client: ReturnType<typeof buildMiraklClient>,
  csv: string,
  attempt = 1
): Promise<string> {
  try {
    const res =
      kind === "STO01"
        ? await client.importStock(csv, { import_mode: "NORMAL" })
        : await client.importPricing(csv, { import_mode: "NORMAL" });
    return String(res?.import_id ?? res?.id ?? "");
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("429") && attempt <= 8) {
      const wait = SLEEP_MS * attempt;
      console.log(`[zero-all-decathlon][${kind}] 429 — wait ${wait}ms then retry #${attempt}`);
      await sleep(wait);
      return importWithRetry(kind, client, csv, attempt + 1);
    }
    throw err;
  }
}

async function disableCron() {
  await withPrismaRetry(
    () =>
      (prisma as any).galaxusJobDefinition.updateMany({
        where: {
          jobKey: {
            in: [
              "decathlon-stock-sync",
              "decathlon-price-sync",
              "decathlon-offer-sync",
              "decathlon-physical-offer-sync",
            ],
          },
        },
        data: { enabled: false },
      }),
    "disable-cron"
  );
  console.log("[zero-all-decathlon] cron stock/price/offer disabled");
}

async function markDbZeroed() {
  const now = new Date();
  await withPrismaRetry(
    () =>
      prisma.$executeRaw`
        UPDATE "DecathlonOfferSync"
        SET "lastStock" = 0,
            "lastPrice" = 0,
            "lastStockSyncedAt" = ${now},
            "lastPriceSyncedAt" = ${now},
            "updatedAt" = ${now}
        WHERE "offerCreatedAt" IS NOT NULL
      `,
    "sync-bulk-zero"
  );
  await withPrismaRetry(
    () =>
      prisma.$executeRaw`
        UPDATE "ChannelListingState"
        SET "lastPushedStock" = 0,
            "lastPushedPrice" = 0,
            status = 'INACTIVE',
            "updatedAt" = ${now}
        WHERE channel = 'DECATHLON'
      `,
    "listing-bulk-zero"
  );
  console.log("[zero-all-decathlon] DB bulk zero applied");
}

async function loadSkus(): Promise<string[]> {
  const rows = await withPrismaRetry(
    () =>
      prisma.$queryRaw<Array<{ providerKey: string }>>`
        SELECT DISTINCT "providerKey"
        FROM "DecathlonOfferSync"
        WHERE "offerCreatedAt" IS NOT NULL
          AND "providerKey" IS NOT NULL
          AND TRIM("providerKey") <> ''
        UNION
        SELECT DISTINCT "providerKey"
        FROM "ChannelListingState"
        WHERE channel = 'DECATHLON'
          AND "providerKey" IS NOT NULL
          AND TRIM("providerKey") <> ''
      `,
    "sku-scan"
  );
  return Array.from(
    new Set(rows.map((r) => String(r.providerKey ?? "").trim()).filter(Boolean))
  ).sort();
}

async function main() {
  // Kill cron first so a mid-run failure cannot re-stock from old code before deploy.
  await disableCron();
  await markDbZeroed();

  const skus = await loadSkus();

  console.log(`[zero-all-decathlon] skus=${skus.length}`);
  if (skus.length === 0) {
    console.log(JSON.stringify({ ok: true, skus: 0, importIds: [], cronDisabled: true }, null, 2));
    return;
  }

  const client = buildMiraklClient();
  const stockImportIds: string[] = [];
  const priceImportIds: string[] = [];
  const batchCount = Math.ceil(skus.length / BATCH);

  const startIndex = (START_BATCH - 1) * BATCH;
  if (startIndex >= skus.length) {
    console.log(JSON.stringify({ ok: true, skus: skus.length, skipped: "start_batch_past_end" }, null, 2));
    return;
  }
  if (START_BATCH > 1) {
    console.log(`[zero-all-decathlon] resume from batch ${START_BATCH} (index ${startIndex})`);
  }

  for (let i = startIndex; i < skus.length; i += BATCH) {
    const chunk = skus.slice(i, i + BATCH);
    const batchNo = Math.floor(i / BATCH) + 1;

    const { csv: stockCsv } = buildSto01Csv(
      chunk.map((offerSku) => ({
        offerSku,
        quantity: 0,
        warehouseCode: WH,
        updateDelete: "UPDATE",
      }))
    );
    const stockImportId = await importWithRetry("STO01", client, stockCsv);
    stockImportIds.push(stockImportId);
    console.log(
      `[zero-all-decathlon][STO01] batch ${batchNo}/${batchCount} size=${chunk.length} import_id=${stockImportId}`
    );

    const { csv: priceCsv } = buildPri01Csv(
      chunk.map((offerSku) => ({
        offerSku,
        price: "0.00",
      }))
    );
    const priceImportId = await importWithRetry("PRI01", client, priceCsv);
    priceImportIds.push(priceImportId);
    console.log(
      `[zero-all-decathlon][PRI01] batch ${batchNo}/${batchCount} size=${chunk.length} import_id=${priceImportId}`
    );

    if (i + BATCH < skus.length) await sleep(SLEEP_MS);
  }

  await markDbZeroed();
  // Re-assert cron off after long run (ensure* may have flipped defaults on VPS).
  await disableCron();

  console.log(
    JSON.stringify(
      {
        ok: true,
        skus: skus.length,
        stockImportIds,
        priceImportIds,
        cronDisabled: true,
        salesPaused: true,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
