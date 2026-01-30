// Backfill shopifyCreatedAt on OrderMatch rows using ShopifyOrder.createdAt
// Run with: node scripts/backfill-shopify-created-at.ts
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("[BACKFILL] Starting backfill of shopifyCreatedAt...");

  const matches = await prisma.orderMatch.findMany({
    where: { shopifyCreatedAt: null },
    select: { id: true, shopifyOrderId: true },
  });

  console.log(`[BACKFILL] Matches needing sell date: ${matches.length}`);
  if (matches.length === 0) {
    console.log("[BACKFILL] Nothing to do.");
    return;
  }

  const shopifyOrderIds = Array.from(
    new Set(
      matches
        .map((m: (typeof matches)[number]) => m.shopifyOrderId)
        .filter(Boolean)
    )
  );

  console.log(`[BACKFILL] Unique Shopify order IDs to lookup: ${shopifyOrderIds.length}`);

  const shopifyOrders = shopifyOrderIds.length
    ? await prisma.shopifyOrder.findMany({
        where: { shopifyOrderId: { in: shopifyOrderIds } },
        select: { shopifyOrderId: true, createdAt: true },
      })
    : [];

  const sellDateMap = new Map<string, Date>();
  for (const o of shopifyOrders) {
    sellDateMap.set(o.shopifyOrderId, o.createdAt);
  }

  let updated = 0;
  let missing = 0;

  for (const m of matches) {
    const sellDate = sellDateMap.get(m.shopifyOrderId);
    if (!sellDate) {
      missing++;
      continue;
    }
    await prisma.orderMatch.update({
      where: { id: m.id },
      data: { shopifyCreatedAt: sellDate },
    });
    updated++;
  }

  console.log(`[BACKFILL] Updated: ${updated}`);
  console.log(`[BACKFILL] Missing (no ShopifyOrder found): ${missing}`);
  console.log("[BACKFILL] Done.");
}

main()
  .catch((err) => {
    console.error("[BACKFILL] Error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

