/**
 * Fix COLD BIEN GTINs where KickDB UPC (no leading 0) != Shopify barcode.
 * attachGtin skips overwrite when gtinDigitsEqual — DB keeps short form, exact
 * gtin queries fail. Stamps Shopify barcode on the correct stx_ row (by SKU).
 */
import { prisma } from "../app/lib/prisma";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { applyLiquidationSaleDisplay } from "../shopify/restock/liquidationPricing";
import { convergeVariant } from "../shopify/inventory/convergence";
import { gtinDigitsEqual } from "../galaxus/stx/physicalImport";
import { resolveKickdbSlugForGtin } from "../shopify/restock/resolveKickdbSlugForGtin";

const GTINS = [
  "00196149208060",
  "0194500875524",
  "0195243827313",
  "0197597311456",
  "197298953344",
  "198686786919",
  "4550456499058",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sizeMatches(sizeRaw: string | null, sizeEu: string | null): boolean {
  if (!sizeRaw || !sizeEu) return false;
  const norm = (s: string) => s.replace(/^EU\s*/i, "").trim();
  return norm(sizeRaw) === norm(sizeEu);
}

async function findStxRowForShopifySku(
  sku: string | null,
  sizeEu: string | null,
  gtin: string
) {
  if (!sku) return null;
  const stylePrefix = sku.replace(/-\d+(\.\d+)?$/, "");
  const candidates = await prisma.supplierVariant.findMany({
    where: {
      supplierVariantId: { startsWith: "stx_" },
      OR: [{ supplierSku: sku }, { supplierSku: stylePrefix }],
    },
    select: {
      id: true,
      supplierVariantId: true,
      gtin: true,
      providerKey: true,
      supplierSku: true,
      sizeRaw: true,
      manualLock: true,
      manualPrice: true,
      images: true,
    },
  });
  const bySize = candidates.filter((r) => sizeMatches(r.sizeRaw, sizeEu));
  if (bySize.length === 1) return bySize[0]!;
  if (bySize.length > 1) {
    const byDigits = bySize.find((r) => r.gtin && gtinDigitsEqual(r.gtin, gtin));
    return byDigits ?? bySize[0]!;
  }
  return candidates.find((r) => r.gtin && gtinDigitsEqual(r.gtin, gtin)) ?? null;
}

async function clearWrongGtinStamps(gtin: string, keepId: string): Promise<void> {
  await prisma.supplierVariant.updateMany({
    where: {
      gtin,
      supplierVariantId: { startsWith: "stx_" },
      NOT: { id: keepId },
    },
    data: { gtin: null, providerKey: null, updatedAt: new Date() },
  });
}

async function stampGtinOnRow(
  row: NonNullable<Awaited<ReturnType<typeof findStxRowForShopifySku>>>,
  gtin: string
): Promise<{ ok: boolean; reason?: string }> {
  const providerKey = `STX_${gtin}`;

  // Detach gtin from any other row (unique providerKey+gtin)
  await prisma.supplierVariant.updateMany({
    where: {
      gtin,
      NOT: { id: row.id },
    },
    data: { gtin: null, providerKey: null, updatedAt: new Date() },
  });

  // If another row holds this providerKey with different gtin, clear it
  await prisma.supplierVariant.updateMany({
    where: {
      providerKey,
      NOT: { id: row.id },
    },
    data: { providerKey: null, updatedAt: new Date() },
  });

  try {
    await prisma.supplierVariant.update({
      where: { id: row.id },
      data: {
        gtin,
        providerKey,
        updatedAt: new Date(),
      },
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: err?.message ?? String(err) };
  }
}

async function main() {
  const results: Array<Record<string, unknown>> = [];

  for (const gtin of GTINS) {
    console.log(`\n=== ${gtin} ===`);
    await sleep(4000);

    const existing = await prisma.supplierVariant.findFirst({
      where: { gtin, supplierVariantId: { startsWith: "stx_" } },
      select: {
        supplierVariantId: true,
        manualLock: true,
        manualPrice: true,
        images: true,
      },
    });
    if (existing) {
      console.log("already has exact gtin row:", existing.supplierVariantId);
    }

    let match;
    try {
      ({ match } = await findShopifyVariantByGtin(gtin));
    } catch (err: any) {
      results.push({ gtin, ok: false, reason: `shopify: ${err.message}` });
      continue;
    }
    if (!match) {
      results.push({ gtin, ok: false, reason: "no_shopify_variant" });
      continue;
    }

    let stxRow = await findStxRowForShopifySku(match.sku, match.variantTitle, gtin);

    if (!stxRow) {
      results.push({
        gtin,
        ok: false,
        reason: "no_stx_row",
        sku: match.sku,
        title: match.productTitle,
      });
      console.log("NO STX ROW for sku", match.sku);
      continue;
    }

    console.log("stx candidate:", stxRow.supplierVariantId, stxRow.supplierSku, "gtin was", stxRow.gtin);

    if (!gtinDigitsEqual(stxRow.gtin, gtin) || existing?.supplierVariantId !== stxRow.supplierVariantId) {
      await clearWrongGtinStamps(gtin, stxRow.id);
      const stamp = await stampGtinOnRow(stxRow, gtin);
      if (!stamp.ok) {
        results.push({ gtin, ok: false, reason: stamp.reason, stxId: stxRow.supplierVariantId });
        continue;
      }
      console.log("stamped gtin on", stxRow.supplierVariantId);
    }

    const slug = (await resolveKickdbSlugForGtin(gtin)) || match.productHandle;
    const liq = await applyLiquidationSaleDisplay({
      gtin,
      variant: match,
      slug,
      sizeEu: match.variantTitle,
    });
    const conv = await convergeVariant(gtin, { postPhysicalRestock: true });

    const final = await prisma.supplierVariant.findFirst({
      where: { gtin, supplierVariantId: { startsWith: "stx_" } },
      select: {
        supplierVariantId: true,
        manualLock: true,
        manualPrice: true,
        images: true,
        providerKey: true,
      },
    });

    const imgCount = Array.isArray(final?.images) ? final!.images.length : 0;
    const galaxusReady = Boolean(
      final?.manualLock &&
        final.manualPrice != null &&
        Number(final.manualPrice) > 0 &&
        imgCount > 0
    );

    results.push({
      gtin,
      ok: true,
      stxId: final?.supplierVariantId,
      salePrice: liq.salePrice,
      manualLock: final?.manualLock,
      manualPrice: final?.manualPrice,
      images: imgCount,
      galaxusReady,
      converge: conv.desired,
    });
    console.log("done", final?.supplierVariantId, "liq", liq.salePrice, "galaxus", galaxusReady);
  }

  console.log("\n=== FINAL TABLE ===");
  console.log("GTIN | stx_id | sale | lock | galaxus");
  for (const r of results) {
    console.log(
      `${r.gtin} | ${r.stxId ?? "—"} | ${r.salePrice ?? "—"} | ${r.manualLock ?? false} | ${r.galaxusReady ? "Y" : "N"}${r.reason ? ` (${r.reason})` : ""}`
    );
  }
  console.log("\nJSON", JSON.stringify(results, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
