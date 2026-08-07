import { prisma } from "@/app/lib/prisma";
import { expandGtinLookupCandidates } from "@/shopify/restock/gtinAliasLookup";
import { resolveKickdbSlugForGtin } from "@/shopify/restock/resolveKickdbSlugForGtin";

/**
 * Catalog identity (brand / name / images) for a physically stocked GTIN.
 *
 * Physical stock is the same product as the dropship catalog — it must never get a
 * second-class catalog row. `isGalaxusCatalogReady` rejects rows without brand + image,
 * so a physical row created from Shopify fields alone can never reach the feed.
 */
export type PhysicalCatalogIdentity = {
  brand: string | null;
  name: string | null;
  images: string[];
  source: "kickdb-local" | "kickdb-api" | "none";
};

const EMPTY: PhysicalCatalogIdentity = {
  brand: null,
  name: null,
  images: [],
  source: "none",
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Gallery first (matches `pickImages` in the STX import path), then the single product image. */
function collectImages(raw: unknown, imageUrl: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const url = str(value);
    if (!url || !isAbsoluteUrl(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  const product = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as any;
  const gallery = product?.gallery ?? product?.data?.gallery;
  if (Array.isArray(gallery)) {
    for (const entry of gallery) {
      if (typeof entry === "string") push(entry);
      else if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        push(o.url ?? o.src ?? o.image ?? o.imageUrl);
      }
    }
  }
  push(product?.image ?? product?.data?.image);
  push(product?.image_url ?? product?.imageUrl);
  push(imageUrl);
  return out;
}

async function fromLocalKickdb(gtin: string): Promise<PhysicalCatalogIdentity | null> {
  const candidates = await expandGtinLookupCandidates(gtin);
  if (candidates.length === 0) return null;

  const variant = await prisma.kickDBVariant.findFirst({
    where: { OR: [{ gtin: { in: candidates } }, { ean: { in: candidates } }] },
    orderBy: { updatedAt: "desc" },
    select: {
      product: {
        select: { name: true, brand: true, imageUrl: true, rawJson: true },
      },
    },
  });

  const product = variant?.product;
  if (!product) return null;

  const images = collectImages(product.rawJson, product.imageUrl);
  const brand = str(product.brand);
  if (!brand || images.length === 0) return null;

  return { brand, name: str(product.name), images, source: "kickdb-local" };
}

async function fromKickdbApi(gtin: string): Promise<PhysicalCatalogIdentity | null> {
  const slug = await resolveKickdbSlugForGtin(gtin);
  if (!slug) return null;

  const { fetchStockxProductByIdOrSlugRaw } = await import("@/galaxus/kickdb/client");
  const { product, raw } = await fetchStockxProductByIdOrSlugRaw(slug);

  const brand = str((product as any)?.brand);
  const images = collectImages(raw, str((product as any)?.image));
  if (!brand || images.length === 0) return null;

  return { brand, name: str((product as any)?.name), images, source: "kickdb-api" };
}

/**
 * Resolve catalog identity for a physical GTIN.
 * Local KickDB rows first — the product was already fetched when it was scanned in,
 * so the common path costs no API quota. Only a genuine local miss hits KickDB.
 */
export async function resolvePhysicalCatalogIdentity(
  gtin: string,
  options: { allowApiFallback?: boolean } = {}
): Promise<PhysicalCatalogIdentity> {
  const clean = String(gtin ?? "").trim();
  if (!clean) return EMPTY;

  const local = await fromLocalKickdb(clean);
  if (local) return local;

  if (options.allowApiFallback === false) return EMPTY;

  try {
    const api = await fromKickdbApi(clean);
    if (api) return api;
  } catch (error) {
    console.warn("[galaxus][physical-recovery] kickdb hydrate failed", {
      gtin: clean,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return EMPTY;
}
