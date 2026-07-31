import { prisma } from "@/app/lib/prisma";

async function main() {
  const match = await prisma.orderMatch.findFirst({
    where: {
      returnReason: { not: null },
      shopifySku: { not: null },
      localStockLotsFromReturn: { none: {} },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      shopifyOrderId: true,
      shopifySku: true,
      shopifyProductTitle: true,
      shopifyTotalPrice: true,
    },
  });

  if (!match) {
    console.log("[create-proof-return] no suitable returned OrderMatch found.");
    process.exit(1);
  }

  const stamp = Date.now();
  const created = await prisma.marketplaceReturn.create({
    data: {
      platform: "decathlon",
      externalReturnId: `proof-local-stock-${stamp}`,
      externalOrderId: match.shopifyOrderId,
      productTitle: match.shopifyProductTitle || "Proof return",
      sku: match.shopifySku,
      returnAmount: Number(match.shopifyTotalPrice) || 1,
      localStatus: "completed",
      processStep: "close_done",
      rawJson: {
        restock: {
          lines: [
            {
              sku: match.shopifySku,
              status: "restocked",
            },
          ],
        },
        orderMatchApply: {
          updatedMatchIds: [match.id],
        },
      },
      staffNote: "runtime-proof: local stock intake validation",
    },
    select: {
      id: true,
      externalReturnId: true,
      externalOrderId: true,
      sku: true,
    },
  });

  console.log("[create-proof-return] created", created);
}

main()
  .catch((error) => {
    console.error("[create-proof-return] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
