import { prisma } from "@/app/lib/prisma";
import { styleIdFromSku } from "@/lib/stockxAutoCheckout/prebuyDedupe";

/** Prefer larger StockX/imgix product shots for email clients. */
export function upgradeMailProductImageUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host.includes("stockx") || host.includes("imgix")) {
      u.searchParams.set("w", "800");
      u.searchParams.set("h", "600");
      u.searchParams.set("fit", "fill");
      if (!u.searchParams.get("bg")) u.searchParams.set("bg", "FFFFFF");
      return u.toString();
    }
  } catch {
    // keep original
  }
  return raw;
}

/**
 * OrderMatch.shopifyLineItemImageUrl → KickDBProduct.imageUrl by styleId.
 * Optionally persist back onto OrderMatch when missing.
 */
export async function resolveDelayMailProductImage(opts: {
  orderMatchId: string;
  shopifySku: string | null;
  shopifyLineItemImageUrl: string | null;
  persist?: boolean;
}): Promise<string | null> {
  const existing = (opts.shopifyLineItemImageUrl || "").trim();
  if (existing) return upgradeMailProductImageUrl(existing);

  const styleId = styleIdFromSku(opts.shopifySku);
  if (!styleId) return null;

  const kp = await prisma.kickDBProduct.findFirst({
    where: {
      OR: [{ styleId }, { styleId: { equals: styleId, mode: "insensitive" } }],
      imageUrl: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { imageUrl: true },
  });
  const resolved = upgradeMailProductImageUrl((kp?.imageUrl || "").trim());
  if (!resolved) return null;

  if (opts.persist !== false) {
    await prisma.orderMatch
      .update({
        where: { id: opts.orderMatchId },
        data: { shopifyLineItemImageUrl: resolved },
      })
      .catch(() => undefined);
  }
  return resolved;
}
