import { prisma } from "@/app/lib/prisma";
import { intakeLocalStockLotsFromReturnReceipt } from "@/shopify/localStock/intakeFromReturnReceipt";

type RestockLine = {
  sku: string | null;
  status: "restocked" | "no-sku" | "variant-not-found" | "no-barcode" | "error";
};

function parseRestockLines(rawJson: unknown): RestockLine[] {
  const root = (rawJson ?? {}) as Record<string, unknown>;
  const restock = (root.restock ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(restock.lines) ? restock.lines : [];
  return lines
    .map((line) => {
      const row = (line ?? {}) as Record<string, unknown>;
      const status = String(row.status ?? "").trim() as RestockLine["status"];
      const sku = String(row.sku ?? "").trim() || null;
      if (!status) return null;
      return { sku, status };
    })
    .filter((x): x is RestockLine => Boolean(x));
}

function parseUpdatedMatchIds(rawJson: unknown): string[] {
  const root = (rawJson ?? {}) as Record<string, unknown>;
  const apply = (root.orderMatchApply ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(apply.updatedMatchIds) ? apply.updatedMatchIds : [];
  return ids.map((id) => String(id ?? "").trim()).filter(Boolean);
}

async function pickReturnRow(explicitId?: string | null) {
  if (explicitId) {
    const row = await prisma.marketplaceReturn.findUnique({
      where: { id: explicitId },
      select: { id: true, localStatus: true, rawJson: true, updatedAt: true },
    });
    return row ?? null;
  }

  const rows = await prisma.marketplaceReturn.findMany({
    where: { localStatus: "completed" },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, localStatus: true, rawJson: true, updatedAt: true },
  });

  for (const row of rows) {
    const ids = parseUpdatedMatchIds(row.rawJson);
    const lines = parseRestockLines(row.rawJson);
    if (ids.length > 0 && lines.some((l) => l.status === "restocked")) {
      return row;
    }
  }
  return null;
}

async function main() {
  const explicitId = String(process.argv[2] ?? "").trim() || null;
  const row = await pickReturnRow(explicitId);
  if (!row) {
    console.log("[validate-local-stock-intake] no eligible completed marketplace return found.");
    process.exit(1);
  }

  const updatedMatchIds = parseUpdatedMatchIds(row.rawJson);
  const restockLines = parseRestockLines(row.rawJson);
  if (!updatedMatchIds.length) {
    console.log("[validate-local-stock-intake] selected return has no updatedMatchIds.", {
      returnId: row.id,
    });
    process.exit(1);
  }

  const beforeCount = await prisma.localStockLot.count({
    where: { sourceMarketplaceReturnId: row.id },
  });

  const result = await intakeLocalStockLotsFromReturnReceipt({
    marketplaceReturnId: row.id,
    updatedMatchIds,
    restockLines,
    now: new Date(),
  });

  const afterCount = await prisma.localStockLot.count({
    where: { sourceMarketplaceReturnId: row.id },
  });

  const lots = await prisma.localStockLot.findMany({
    where: { sourceMarketplaceReturnId: row.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      sku: true,
      origin: true,
      costBasis: true,
      qtyAvailable: true,
      sourceOrderMatchId: true,
      migrationKey: true,
      createdAt: true,
    },
  });

  console.log("[validate-local-stock-intake] runtime proof", {
    returnId: row.id,
    updatedAt: row.updatedAt,
    beforeCount,
    intakeResult: result,
    afterCount,
    sampleLots: lots,
  });
}

main()
  .catch((error) => {
    console.error("[validate-local-stock-intake] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
