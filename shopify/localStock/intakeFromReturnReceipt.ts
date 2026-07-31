import { prisma } from "@/app/lib/prisma";
import { findVariantBySku } from "@/shopify/catalog/graphql";
import { LOCATIONS } from "@/shopify/inventory/locationConfig";

type RestockLine = {
  sku: string | null;
  status: "restocked" | "no-sku" | "variant-not-found" | "no-barcode" | "error";
};

export type IntakeReturnLotsInput = {
  marketplaceReturnId: string;
  updatedMatchIds: string[];
  restockLines: RestockLine[];
  now?: Date;
};

export type IntakeReturnLotsResult = {
  created: number;
  skipped: number;
  warnings: string[];
  lotIds: string[];
};

const BUSSIGNY_LOCATION =
  LOCATIONS.find((l) => l.sourceType === "physical" && /bussigny/i.test(l.name)) ??
  LOCATIONS.find((l) => l.sourceType === "physical") ??
  null;

function normalizeSku(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export async function intakeLocalStockLotsFromReturnReceipt(
  input: IntakeReturnLotsInput
): Promise<IntakeReturnLotsResult> {
  const warnings: string[] = [];
  const lotIds: string[] = [];
  const updatedMatchIds = Array.from(
    new Set((input.updatedMatchIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))
  );
  if (!updatedMatchIds.length) {
    return { created: 0, skipped: 0, warnings, lotIds };
  }
  if (!BUSSIGNY_LOCATION) {
    return {
      created: 0,
      skipped: updatedMatchIds.length,
      warnings: ["No physical location configured for return lot intake."],
      lotIds,
    };
  }

  const restockedSkus = new Set(
    (input.restockLines ?? [])
      .filter((line) => line?.status === "restocked")
      .map((line) => normalizeSku(line?.sku))
      .filter(Boolean)
  );

  const matches = await prisma.orderMatch.findMany({
    where: { id: { in: updatedMatchIds } },
    select: {
      id: true,
      shopifySku: true,
      shopifySizeEU: true,
      shopifyProductTitle: true,
      returnedStockValueChf: true,
    },
  });

  let created = 0;
  let skipped = 0;
  const now = input.now ?? new Date();

  for (const match of matches) {
    const sku = normalizeSku(match.shopifySku);
    if (!sku) {
      skipped += 1;
      warnings.push(`Skip ${match.id}: empty SKU.`);
      continue;
    }
    if (restockedSkus.size > 0 && !restockedSkus.has(sku)) {
      skipped += 1;
      warnings.push(`Skip ${match.id}: SKU ${sku} was not restocked successfully.`);
      continue;
    }

    const migrationKey = `returnMatch:${match.id}`;
    const existing = await prisma.localStockLot.findUnique({
      where: { migrationKey },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      lotIds.push(existing.id);
      continue;
    }

    const variant = await findVariantBySku(sku);
    if (!variant) {
      skipped += 1;
      warnings.push(`Skip ${match.id}: no Shopify variant found for SKU ${sku}.`);
      continue;
    }
    const sourceValue = Number(match.returnedStockValueChf ?? 0);
    const lot = await prisma.localStockLot.create({
      data: {
        shopifyProductId: variant.productId || null,
        shopifyVariantId: variant.variantId,
        inventoryItemId: variant.inventoryItemId || null,
        sku,
        gtin: null,
        sizeLabel: match.shopifySizeEU || null,
        locationId: BUSSIGNY_LOCATION.id,
        locationName: BUSSIGNY_LOCATION.name,
        origin: "CUSTOMER_RETURN",
        costBasis: "ALREADY_EXPENSED",
        unitCostChf: 0,
        currencyCode: "CHF",
        qtyInitial: 1,
        qtyAvailable: 1,
        qtySold: 0,
        status: "OPEN",
        sourceOrderMatchId: match.id,
        sourceMarketplaceReturnId: input.marketplaceReturnId,
        enteredAt: now,
        notes:
          sourceValue > 0
            ? `Return intake. Original return stock value was CHF ${sourceValue.toFixed(2)}.`
            : "Return intake. Cost already expensed on original return line.",
        migrationKey,
      },
      select: { id: true },
    });

    created += 1;
    lotIds.push(lot.id);
  }

  return { created, skipped, warnings, lotIds };
}
