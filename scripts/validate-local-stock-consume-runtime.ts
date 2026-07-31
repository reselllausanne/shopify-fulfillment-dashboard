import { prisma } from "@/app/lib/prisma";
import { tryConsumeLocalStockLot } from "@/shopify/localStock/consumeFromLocalStock";

async function main() {
  const preferredLotId = String(process.argv[2] ?? "").trim() || null;

  const lot = preferredLotId
    ? await prisma.localStockLot.findFirst({
        where: { id: preferredLotId, status: "OPEN", qtyAvailable: { gt: 0 } },
      })
    : await prisma.localStockLot.findFirst({
        where: { status: "OPEN", qtyAvailable: { gt: 0 } },
        orderBy: { enteredAt: "asc" },
      });

  if (!lot) {
    console.log("[validate-local-stock-consume] no OPEN lot available.");
    process.exit(1);
  }

  const before = {
    id: lot.id,
    sku: lot.sku,
    qtyAvailable: lot.qtyAvailable,
    qtySold: lot.qtySold,
    status: lot.status,
  };

  const consumed = await tryConsumeLocalStockLot({
    lotId: lot.id,
    shopifySku: lot.sku,
    revenue: 199,
  });

  const after = await prisma.localStockLot.findUnique({
    where: { id: lot.id },
    select: {
      id: true,
      sku: true,
      qtyAvailable: true,
      qtySold: true,
      status: true,
      unitCostChf: true,
      origin: true,
    },
  });

  console.log("[validate-local-stock-consume] runtime proof", {
    before,
    consumeResult: consumed,
    after,
  });

  if (!consumed || !after) {
    process.exit(1);
  }
  if (after.qtyAvailable !== before.qtyAvailable - 1) {
    console.error("[validate-local-stock-consume] qtyAvailable did not decrement");
    process.exit(1);
  }
  if (after.qtySold !== before.qtySold + 1) {
    console.error("[validate-local-stock-consume] qtySold did not increment");
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error("[validate-local-stock-consume] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
