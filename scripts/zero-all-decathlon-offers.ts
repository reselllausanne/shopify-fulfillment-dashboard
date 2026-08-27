/**
 * Zero ALL Decathlon Mirakl offers (STX + everything else) and disable stock/price cron.
 * Used with isDecathlonSalesPaused() so sync cannot re-list.
 *
 * Usage: npx tsx scripts/zero-all-decathlon-offers.ts
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { buildMiraklClient } from "@/decathlon/mirakl/client";
import { buildSto01Csv } from "@/decathlon/mirakl/csv";
import { DECATHLON_MIRAKL_WAREHOUSE_CODE } from "@/decathlon/mirakl/config";

const BATCH = 2000;
const WH = DECATHLON_MIRAKL_WAREHOUSE_CODE;
const SLEEP_MS = 15_000;

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
      code === "P1017" || /closed the connection|Can't reach database|Connection reset/i.test(msg);
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
  client: ReturnType<typeof buildMiraklClient>,
  csv: string,
  attempt = 1
): Promise<string> {
  try {
    const res = await client.importStock(csv, { import_mode: "NORMAL" });
    return String(res?.import_id ?? res?.id ?? "");
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("429") && attempt <= 8) {
      const wait = SLEEP_MS * attempt;
      console.log(`[zero-all-decathlon] 429 — wait ${wait}ms then retry #${attempt}`);
      await sleep(wait);
      return importWithRetry(client, csv, attempt + 1);
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

async function main() {
  // Kill cron first so a mid-run failure cannot re-stock from old code before deploy.
  await disableCron();

  const rows = await withPrismaRetry(
    () =>
      prisma.channelListingState.findMany({
        where: {
          channel: "DECATHLON",
          OR: [{ lastPushedStock: { gt: 0 } }, { status: "ACTIVE" }, { status: "PENDING" }],
        },
        select: { providerKey: true },
      }),
    "listing-scan"
  );

  // Always re-zero known Mirakl offers. lastStock=0 in DB does NOT mean Mirakl qty is 0
  // (hard-disable blocked later STO01, so leftover qty stays buyable).
  const fromSync = await withPrismaRetry(
    () =>
      (prisma as any).decathlonOfferSync.findMany({
        where: { offerCreatedAt: { not: null } },
        select: { providerKey: true },
      }),
    "sync-scan"
  );

  const skus = Array.from(
    new Set(
      [...rows, ...fromSync]
        .map((r: { providerKey: string }) => String(r.providerKey ?? "").trim())
        .filter(Boolean)
    )
  );

  console.log(`[zero-all-decathlon] skus=${skus.length}`);
  if (skus.length === 0) {
    console.log(JSON.stringify({ ok: true, skus: 0, importIds: [], cronDisabled: true }, null, 2));
    return;
  }

  const client = buildMiraklClient();
  const importIds: string[] = [];

  for (let i = 0; i < skus.length; i += BATCH) {
    const chunk = skus.slice(i, i + BATCH);
    const { csv } = buildSto01Csv(
      chunk.map((offerSku) => ({
        offerSku,
        quantity: 0,
        warehouseCode: WH,
        updateDelete: "UPDATE",
      }))
    );
    const importId = await importWithRetry(client, csv);
    importIds.push(importId);
    console.log(
      `[zero-all-decathlon] batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(skus.length / BATCH)} size=${chunk.length} import_id=${importId}`
    );

    const now = new Date();
    await withPrismaRetry(
      () =>
        prisma.channelListingState.updateMany({
          where: { channel: "DECATHLON", providerKey: { in: chunk } },
          data: { lastPushedStock: 0, status: "INACTIVE", updatedAt: now },
        }),
      `listing-update-${i}`
    );
    await withPrismaRetry(
      () =>
        (prisma as any).decathlonOfferSync.updateMany({
          where: { providerKey: { in: chunk } },
          data: { lastStock: 0, lastStockSyncedAt: now, updatedAt: now },
        }),
      `sync-update-${i}`
    );

    if (i + BATCH < skus.length) await sleep(SLEEP_MS);
  }

  // Re-assert cron off after long run (ensure* may have flipped defaults on VPS).
  await disableCron();

  console.log(
    JSON.stringify({ ok: true, skus: skus.length, importIds, cronDisabled: true, salesPaused: true }, null, 2)
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
