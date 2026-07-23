import { prisma } from "@/app/lib/prisma";
import {
  clearVariantBarcode,
  getShopifyVariantDetail,
  listShopifyVariantsByGtinDetailed,
  setVariantBarcode,
} from "@/shopify/restock/shopifyRestockInventory";

function cleanGtin(value: string): string {
  return String(value ?? "").replace(/\D/g, "").trim();
}

/**
 * Assign GTIN exclusively to one Shopify variant: write barcode on the chosen
 * variant and clear it from every other variant that currently holds it.
 */
export async function assignGtinToVariantExclusive(input: {
  gtin: string;
  chosenVariantId: string;
}): Promise<{ warnings: string[] }> {
  const gtin = cleanGtin(input.gtin);
  const chosenVariantId = String(input.chosenVariantId ?? "").trim();
  const warnings: string[] = [];
  if (!gtin || !chosenVariantId) {
    throw new Error("GTIN and chosenVariantId required");
  }

  const all = await listShopifyVariantsByGtinDetailed(gtin);
  const chosen = all.find((v) => v.variantId === chosenVariantId);
  if (!chosen) {
    const fallback = await getShopifyVariantDetail(chosenVariantId);
    if (!fallback?.productId) {
      throw new Error("Chosen variant not found on Shopify");
    }
    await setVariantBarcode({
      productId: fallback.productId,
      variantId: fallback.variantId,
      barcode: gtin,
    });
    warnings.push(`Barcode ${gtin} set on chosen variant (was not in GTIN search list)`);
  } else {
    await setVariantBarcode({
      productId: chosen.productId,
      variantId: chosen.variantId,
      barcode: gtin,
    });
  }

  for (const loser of all) {
    if (loser.variantId === chosenVariantId) continue;
    try {
      await clearVariantBarcode({
        productId: loser.productId,
        variantId: loser.variantId,
      });
      warnings.push(`Cleared duplicate GTIN from ${loser.sku ?? loser.variantId}`);
    } catch (err: any) {
      warnings.push(
        `Failed clearing GTIN on ${loser.sku ?? loser.variantId}: ${err?.message ?? err}`
      );
    }
  }

  // DB mirror: drop gtin from loser rows (chosen row gets gtin on next mirror upsert).
  try {
    const loserIds = all.filter((v) => v.variantId !== chosenVariantId).map((v) => v.variantId);
    if (loserIds.length) {
      await prisma.shopifyVariantLocationStock.updateMany({
        where: { shopifyVariantId: { in: loserIds }, gtin },
        data: { gtin: null },
      });
    }
    await prisma.shopifyVariantLocationStock.updateMany({
      where: { shopifyVariantId: chosenVariantId },
      data: { gtin },
    });
  } catch (err: any) {
    warnings.push(`DB mirror GTIN cleanup skipped: ${err?.message ?? err}`);
  }

  // SupplierVariant: prefer row whose providerKey/SKU aligns with chosen variant SKU.
  try {
    const chosenDetail =
      chosen ?? (await getShopifyVariantDetail(chosenVariantId));
    const chosenSku = String(chosenDetail?.sku ?? "").trim();
    if (chosenSku) {
      const dupRows = await prisma.supplierVariant.findMany({
        where: { gtin },
        select: { id: true, providerKey: true },
      });
      for (const row of dupRows) {
        const key = String(row.providerKey ?? "").trim();
        const matchesChosen =
          key === chosenSku || key.endsWith(`-${chosenSku}`) || chosenSku.endsWith(key);
        if (!matchesChosen) {
          await prisma.supplierVariant.update({
            where: { id: row.id },
            data: { gtin: null },
          });
          warnings.push(`Cleared GTIN on SupplierVariant ${row.providerKey ?? row.id}`);
        }
      }
    }
  } catch (err: any) {
    warnings.push(`SupplierVariant GTIN cleanup skipped: ${err?.message ?? err}`);
  }

  return { warnings };
}
