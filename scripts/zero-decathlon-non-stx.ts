/**
 * ASAP: zero ALL non-STX Decathlon Mirakl offers (NER/BAE/REI/WEL/GLD/SNL/…).
 * Decathlon lane = STX express only.
 *
 * Usage: npx tsx scripts/zero-decathlon-non-stx.ts
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { buildMiraklClient } from "@/decathlon/mirakl/client";
import { buildSto01Csv } from "@/decathlon/mirakl/csv";
import { DECATHLON_MIRAKL_WAREHOUSE_CODE } from "@/decathlon/mirakl/config";

const BATCH = 5000;
const WH = DECATHLON_MIRAKL_WAREHOUSE_CODE;
const SLEEP_MS = 12_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
      console.log(`[zero-non-stx] 429 — wait ${wait}ms then retry #${attempt}`);
      await sleep(wait);
      return importWithRetry(client, csv, attempt + 1);
    }
    throw err;
  }
}

async function main() {
  const rows = await prisma.channelListingState.findMany({
    where: {
      channel: "DECATHLON",
      NOT: { providerKey: { startsWith: "STX_" } },
      OR: [{ lastPushedStock: { gt: 0 } }, { status: "ACTIVE" }, { status: "PENDING" }],
    },
    select: { providerKey: true },
  });

  const fromSync = await (prisma as any).decathlonOfferSync.findMany({
    where: {
      NOT: { providerKey: { startsWith: "STX_" } },
      OR: [{ lastStock: { gt: 0 } }, { lastStock: null }],
    },
    select: { providerKey: true },
  });

  const skus = Array.from(
    new Set(
      [...rows, ...fromSync]
        .map((r: { providerKey: string }) => String(r.providerKey ?? "").trim())
        .filter((k) => k && !k.toUpperCase().startsWith("STX_"))
    )
  );

  console.log(`[zero-non-stx] skus=${skus.length}`);
  if (skus.length === 0) {
    console.log("nothing to zero");
    return;
  }

  const client = buildMiraklClient();
  const importIds: string[] = [];
  const doneSkus: string[] = [];

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
    doneSkus.push(...chunk);
    console.log(
      `[zero-non-stx] batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(skus.length / BATCH)} size=${chunk.length} import_id=${importId}`
    );
    // Mark this batch zeroed in DB immediately so a crash mid-run still helps.
    const now = new Date();
    await prisma.channelListingState.updateMany({
      where: { channel: "DECATHLON", providerKey: { in: chunk } },
      data: { lastPushedStock: 0, status: "INACTIVE", updatedAt: now },
    });
    await (prisma as any).decathlonOfferSync.updateMany({
      where: { providerKey: { in: chunk } },
      data: { lastStock: 0, lastStockSyncedAt: now, updatedAt: now },
    });
    if (i + BATCH < skus.length) await sleep(SLEEP_MS);
  }

  await (prisma as any).galaxusJobDefinition.updateMany({
    where: { jobKey: "decathlon-physical-offer-sync" },
    data: { enabled: false },
  });

  console.log(JSON.stringify({ ok: true, skus: doneSkus.length, importIds }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
