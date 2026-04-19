import { prisma } from "@/app/lib/prisma";

/**
 * Pick the same supplier variant as assign route: for a GTIN, prefer the partner-prefixed
 * mapping with the highest current stock (best-effort when multiple rows share a GTIN).
 */
async function resolveSupplierVariantForPartnerGtin(
  tx: any,
  gtin: string,
  partnerKeyLower: string
): Promise<{ supplierVariantId: string; stock: number } | null> {
  const prefix = `${partnerKeyLower}:`;
  const mappings = await tx.variantMapping.findMany({
    where: {
      gtin,
      supplierVariantId: { startsWith: prefix, mode: "insensitive" },
    },
    include: { supplierVariant: true },
  });
  let best: { supplierVariantId: string; stock: number } | null = null;
  for (const m of mappings) {
    const sv = m.supplierVariant;
    const id = String(m.supplierVariantId ?? sv?.supplierVariantId ?? "").trim();
    if (!id) continue;
    const stock = Number(sv?.stock ?? 0);
    if (!best || stock > best.stock) {
      best = { supplierVariantId: id, stock };
    }
  }
  return best;
}

/**
 * When a partner marks a Galaxus-linked order fulfilled, decrement catalog stock (floor at 0).
 * Idempotent: skips if the partner order was already FULFILLED before this call.
 */
export async function deductStockForPartnerOrderFulfillment(params: {
  partnerOrderId: string;
  partnerKeyLower: string;
  previousStatus: string | null | undefined;
}): Promise<{ adjusted: number; skipped: boolean; details: string[] }> {
  const { partnerOrderId, partnerKeyLower, previousStatus } = params;
  const details: string[] = [];
  if (String(previousStatus ?? "").toUpperCase() === "FULFILLED") {
    return { adjusted: 0, skipped: true, details: ["already fulfilled"] };
  }

  const prefix = `${partnerKeyLower}:`;
  const prismaAny = prisma as any;
  const lines = await prismaAny.partnerOrderLine.findMany({
    where: { partnerOrderId },
  });
  if (!lines.length) {
    return { adjusted: 0, skipped: false, details: ["no lines"] };
  }

  let adjusted = 0;
  await prisma.$transaction(async (tx) => {
    const txAny = tx as any;
    for (const line of lines) {
      const qty = Math.max(1, Math.round(Number(line.quantity ?? 1)));
      const gtin = String(line.gtin ?? "").trim();
      let targetId = String(line.supplierVariantId ?? "").trim();

      if (!targetId && gtin) {
        const resolved = await resolveSupplierVariantForPartnerGtin(txAny, gtin, partnerKeyLower);
        targetId = resolved?.supplierVariantId ?? "";
      }

      if (!targetId) {
        details.push(`skip line ${line.id}: no supplierVariantId`);
        continue;
      }
      if (!targetId.toLowerCase().startsWith(prefix)) {
        details.push(`skip line ${line.id}: variant ${targetId} not owned by partner`);
        continue;
      }

      const variant = await txAny.supplierVariant.findUnique({
        where: { supplierVariantId: targetId },
      });
      if (!variant) {
        details.push(`skip line ${line.id}: variant missing`);
        continue;
      }

      const current = Math.max(0, Math.round(Number(variant.stock ?? 0)));
      const next = Math.max(0, current - qty);
      if (next !== current) {
        await txAny.supplierVariant.update({
          where: { supplierVariantId: targetId },
          data: { stock: next },
        });
        adjusted += 1;
        details.push(`${targetId}: ${current} → ${next} (−${qty})`);
      }
    }
  });

  return { adjusted, skipped: false, details };
}
