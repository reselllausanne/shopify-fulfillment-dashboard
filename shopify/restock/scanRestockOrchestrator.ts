import { pickPersistedKickdbSizes, pickString } from "@/galaxus/kickdb/extract";
import {
  searchStockxProducts,
  fetchStockxProductByIdOrSlugRaw,
  extractVariantGtin,
} from "@/galaxus/kickdb/client";
import { importStxProductByInput } from "@/galaxus/stx/importProduct";
import {
  createProductFullFlow,
  resolveProductIdentifier,
} from "@/shopify/restock/createProductFullFlow";
import {
  activateInventoryAtLocation,
  adjustInventoryAtLocation,
  findShopifyVariantByGtin,
  listShopifyVariantsByGtinDetailed,
  resolveBussignyLocationId,
  restockShopifyVariantByGtin,
  setVariantBarcode,
  type RestockShopifyResult,
  type ShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";
import { assignGtinToVariantExclusive } from "@/shopify/restock/gtinResolution";
import { ensureManualSizeVariant, isManualPriceRequiredError } from "@/shopify/restock/createManualVariant";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";
import { isManualOnlyGtin } from "@/shopify/inventory/manualOnlyGtins";
import { convergeVariant } from "@/shopify/inventory/convergence";
import { cleanGtin, gtinCandidates, gtinEquals } from "@/shopify/restock/gtinNormalize";
import {
  findExistingShopifyProductForCatalogIdentifier,
  formatSizeEuLabel,
  isValidEuSizeForCreate,
  sanitizeEuSizeForCreate,
  parseSizeToNumber,
  pickVariantBySize,
  sizeTitlesMatch,
  type ShopifyVariantChoice,
} from "@/shopify/restock/shopifyExistingProduct";

/** After a real (non-dry-run) physical restock: lock liquidation state immediately. */
async function runPostRestockConvergence(
  gtin: string,
  dryRun: boolean | undefined,
  warnings: string[]
): Promise<void> {
  if (dryRun || isManualOnlyGtin(gtin)) return;
  try {
    // Mirror may lag — convergeVariant reads ShopifyVariantLocationStock.
    // Force a single-GTIN convergence; if mirror still 0, next cron retries.
    const conv = await convergeVariant(gtin);
    if (conv.changed) {
      warnings.push(`Convergence: ${conv.changes.join("; ")}`);
    } else if (conv.warnings.length) {
      warnings.push(...conv.warnings.map((w) => `Convergence: ${w}`));
    }
  } catch (err: any) {
    warnings.push(`Convergence post-restock failed: ${err?.message ?? err}`);
  }
}

/**
 * Shape A (GTIN already on Shopify) used to skip DB import — then marketplace
 * had no STX row to merge physical qty into, and convergence could not lock
 * liquidation. Ensure an stx_ SupplierVariant exists when KickDB has a slug.
 */
async function ensureStxSupplierForGtin(
  gtin: string,
  dryRun: boolean | undefined,
  warnings: string[]
): Promise<{ ok: boolean; importedVariantsCount?: number; errors?: string[] }> {
  if (dryRun || isManualOnlyGtin(gtin)) {
    return { ok: true, importedVariantsCount: 0 };
  }
  try {
    const existing = await prisma.supplierVariant.findFirst({
      where: { gtin, supplierVariantId: { startsWith: "stx_" } },
      select: { id: true },
    });
    if (existing) return { ok: true, importedVariantsCount: 0 };

    const kv = await prisma.kickDBVariant.findFirst({
      where: { OR: [{ gtin }, { ean: gtin }] },
      select: { product: { select: { urlKey: true } } },
    });
    const slug = String(kv?.product?.urlKey ?? "").trim();
    if (!slug) {
      warnings.push(
        `Import DB ignoré: pas de slug KickDB pour ${gtin} — marketplace ne verra pas ce stock physique`
      );
      return { ok: false, errors: ["kickdb_slug_missing"] };
    }

    const imported = await importStxProductByInput(slug, {
      forceImport: true,
      targetGtin: gtin,
    });
    if (!imported.ok) {
      warnings.push(
        `Import DB (Galaxus/Decathlon) échoué: ${imported.errors.join("; ") || "raison inconnue"}`
      );
      return { ok: false, importedVariantsCount: 0, errors: imported.errors };
    }
    warnings.push(`Import DB: ${imported.importedVariantsCount ?? 0} variantes STX (forceImport)`);
    return {
      ok: true,
      importedVariantsCount: imported.importedVariantsCount,
      errors: imported.errors,
    };
  } catch (err: any) {
    warnings.push(`Import DB erreur: ${err?.message ?? err}`);
    return { ok: false, errors: [err?.message ?? String(err)] };
  }
}

/**
 * Case 3 orchestrator — physical stock scan (GTIN).
 *
 * Cascade (validated with user):
 *  1. GTIN -> Shopify barcode lookup. Hit = stock at Bussigny, done.
 *  2. Miss -> local data sources (KickDBVariant/ean, VariantMapping,
 *     SupplierVariant, AlternativeProduct, PartnerVariant). KickDB search does
 *     NOT index GTINs, so our own tables are the real GTIN->product map.
 *  3. Miss -> KickDB text search by GTIN (best-effort, almost always empty).
 *  4. Still nothing -> manual input (SKU/slug from the box, which is always printed).
 *     Creation via slug/SKU: Shopify (Python full pipeline) + DB
 *     (importStxProductByInput -> SupplierVariant for Galaxus/Decathlon export).
 *  5. Guard: after creation, if the scanned GTIN matches no created barcode,
 *     require explicit size confirmation before writing the barcode
 *     (lesson from the Ultraboost KickDB bad-data incident).
 */

export type ScanLookupResult =
  | {
      status: "on-shopify";
      gtin: string;
      variant: ShopifyVariantDetail;
      ambiguous: boolean;
      ambiguousMatches?: ShopifyVariantDetail[];
    }
  | {
      status: "resolved";
      gtin: string;
      slug: string;
      title: string | null;
      brand: string | null;
      styleSku: string | null;
      image: string | null;
      /** true when a KickDB variant GTIN matches the scanned GTIN exactly */
      gtinConfirmed: boolean;
      matchedSizeEu: string | null;
      matchedSizeUs: string | null;
    }
  | {
      status: "shopify-exists-no-gtin";
      gtin: string;
      slug: string;
      title: string | null;
      brand: string | null;
      styleSku: string | null;
      image: string | null;
      productId: string;
      gtinConfirmed: boolean;
      matchedSizeEu: string | null;
      matchedSizeUs: string | null;
      suggestedVariantId: string | null;
      variantChoices: Array<{
        variantId: string;
        title: string | null;
        sku: string | null;
        barcode: string | null;
        price: string | null;
      }>;
      matchedVia: string;
    }
  | {
      status: "not-found";
      gtin: string;
      message: string;
    };

function pickStr(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function inspectKickdbSlugForGtin(
  slug: string,
  gtin: string
): Promise<{ gtinConfirmed: boolean; matchedSizeEu: string | null; matchedSizeUs: string | null }> {
  const candidates = gtinCandidates(gtin);
  try {
    const { product } = await fetchStockxProductByIdOrSlugRaw(slug);
    const variants = Array.isArray((product as any)?.variants) ? (product as any).variants : [];
    for (const variant of variants) {
      const vGtin = extractVariantGtin(variant);
      if (!vGtin) continue;
      if (!candidates.some((c) => gtinEquals(vGtin, c))) continue;
      const { sizeEu, sizeUs } = pickPersistedKickdbSizes(variant);
      const euSize = sanitizeEuSizeForCreate(sizeEu);
      return {
        gtinConfirmed: true,
        matchedSizeEu: euSize,
        matchedSizeUs: pickStr(sizeUs, variant?.size_us, variant?.size),
      };
    }
  } catch {
    // Non-fatal: detail fetch failure just means we cannot confirm the GTIN.
  }
  return { gtinConfirmed: false, matchedSizeEu: null, matchedSizeUs: null };
}

/** All KickDB/StockX variants with GTIN + EU size (fallback picker). */
async function listKickdbGtinSizeOptions(slug: string, gtin: string) {
  const candidates = gtinCandidates(gtin);
  try {
    const { product } = await fetchStockxProductByIdOrSlugRaw(slug);
    const variants = Array.isArray((product as any)?.variants) ? (product as any).variants : [];
    return variants
      .map((variant: any) => {
        const vGtin = extractVariantGtin(variant);
        const { sizeEu, sizeUs } = pickPersistedKickdbSizes(variant);
        const eu = sanitizeEuSizeForCreate(sizeEu);
        if (!eu && !vGtin) return null;
        return {
          sizeEu: eu,
          sizeUs: pickString(sizeUs),
          gtin: vGtin,
          gtinMatch: Boolean(vGtin && candidates.some((c) => gtinEquals(vGtin, c))),
        };
      })
      .filter(Boolean) as Array<{
      sizeEu: string | null;
      sizeUs: string | null;
      gtin: string | null;
      gtinMatch: boolean;
    }>;
  } catch {
    return [];
  }
}

type LocalGtinHit = {
  slug: string | null;
  styleSku: string | null;
  title: string | null;
  brand: string | null;
  image: string | null;
  sizeEu: string | null;
  sizeUs: string | null;
  source: string;
};

/**
 * Look up a GTIN across every local catalog source we own, in priority order:
 *  1. KickDBVariant (gtin OR ean) -> StockX slug (best identifier)
 *  2. VariantMapping -> linked KickDB slug, else linked supplier SKU
 *  3. SupplierVariant (gtin) -> supplier SKU (Galaxus/Decathlon export catalog)
 *  4. AlternativeProduct (gtin) -> partner externalKey
 *  5. PartnerVariant (gtin) -> partner externalSku
 * Read-only. Returns null if no source knows the GTIN.
 */
async function resolveGtinFromLocalSources(gtin: string): Promise<LocalGtinHit | null> {
  const cands = gtinCandidates(gtin);
  if (!cands.length) return null;
  const p = prisma as any;

  // 1. KickDBVariant (gtin or ean) -> slug
  const kv = await p.kickDBVariant.findFirst({
    where: { OR: [{ gtin: { in: cands } }, { ean: { in: cands } }] },
    select: {
      sizeEu: true,
      sizeUs: true,
      product: { select: { urlKey: true, name: true, brand: true, styleId: true, imageUrl: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (kv?.product?.urlKey || kv?.product?.styleId) {
    return {
      slug: pickStr(kv.product?.urlKey),
      styleSku: pickStr(kv.product?.styleId),
      title: pickStr(kv.product?.name),
      brand: pickStr(kv.product?.brand),
      image: pickStr(kv.product?.imageUrl),
      sizeEu: pickStr(kv.sizeEu),
      sizeUs: pickStr(kv.sizeUs),
      source: "kickdb-variant",
    };
  }

  // 2. VariantMapping -> kickdb slug, else supplier sku
  const vm = await p.variantMapping.findFirst({
    where: { gtin: { in: cands } },
    select: {
      kickdbVariant: {
        select: {
          sizeEu: true,
          sizeUs: true,
          product: { select: { urlKey: true, name: true, brand: true, styleId: true, imageUrl: true } },
        },
      },
      supplierVariant: {
        select: {
          supplierSku: true,
          supplierProductName: true,
          supplierBrand: true,
          sizeNormalized: true,
          sourceImageUrl: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const vmKp = vm?.kickdbVariant?.product;
  if (vmKp?.urlKey) {
    return {
      slug: pickStr(vmKp.urlKey),
      styleSku: pickStr(vmKp.styleId),
      title: pickStr(vmKp.name),
      brand: pickStr(vmKp.brand),
      image: pickStr(vmKp.imageUrl),
      sizeEu: pickStr(vm.kickdbVariant?.sizeEu),
      sizeUs: pickStr(vm.kickdbVariant?.sizeUs),
      source: "variant-mapping-kickdb",
    };
  }
  if (vm?.supplierVariant?.supplierSku) {
    const sv = vm.supplierVariant;
    return {
      slug: null,
      styleSku: pickStr(sv.supplierSku),
      title: pickStr(sv.supplierProductName),
      brand: pickStr(sv.supplierBrand),
      image: pickStr(sv.sourceImageUrl),
      sizeEu: pickStr(sv.sizeNormalized),
      sizeUs: null,
      source: "variant-mapping-supplier",
    };
  }

  // 3. SupplierVariant direct (export catalog)
  const sv = await p.supplierVariant.findFirst({
    where: { gtin: { in: cands } },
    select: {
      supplierSku: true,
      supplierProductName: true,
      supplierBrand: true,
      sizeNormalized: true,
      sourceImageUrl: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (sv?.supplierSku) {
    return {
      slug: null,
      styleSku: pickStr(sv.supplierSku),
      title: pickStr(sv.supplierProductName),
      brand: pickStr(sv.supplierBrand),
      image: pickStr(sv.sourceImageUrl),
      sizeEu: pickStr(sv.sizeNormalized),
      sizeUs: null,
      source: "supplier-variant",
    };
  }

  // 4. AlternativeProduct (partner catalog)
  const ap = await p.alternativeProduct.findFirst({
    where: { gtin: { in: cands } },
    select: { externalKey: true, title: true, brand: true, size: true, mainImageUrl: true },
    orderBy: { updatedAt: "desc" },
  });
  if (ap) {
    return {
      slug: null,
      styleSku: pickStr(ap.externalKey),
      title: pickStr(ap.title),
      brand: pickStr(ap.brand),
      image: pickStr(ap.mainImageUrl),
      sizeEu: pickStr(ap.size),
      sizeUs: null,
      source: "alternative-product",
    };
  }

  // 5. PartnerVariant
  const pv = await p.partnerVariant.findFirst({
    where: { gtin: { in: cands } },
    select: { externalSku: true, productName: true, brand: true, sizeRaw: true },
    orderBy: { updatedAt: "desc" },
  });
  if (pv?.externalSku) {
    return {
      slug: null,
      styleSku: pickStr(pv.externalSku),
      title: pickStr(pv.productName),
      brand: pickStr(pv.brand),
      image: null,
      sizeEu: pickStr(pv.sizeRaw),
      sizeUs: null,
      source: "partner-variant",
    };
  }

  return null;
}

type CatalogHit = {
  slug: string;
  title: string | null;
  brand: string | null;
  styleSku: string | null;
  image: string | null;
  gtinConfirmed: boolean;
  matchedSizeEu: string | null;
  matchedSizeUs: string | null;
};

function mapVariantChoices(
  variants: Awaited<ReturnType<typeof listProductVariants>>
): ShopifyVariantChoice[] {
  return variants.map((v) => ({
    variantId: v.variantId,
    title: v.title,
    sku: v.sku,
    barcode: v.barcode,
    price: v.price,
    inventoryItemId: v.inventoryItemId,
  }));
}

function toPublicVariantChoices(variants: ShopifyVariantChoice[]) {
  return variants.map((v) => ({
    variantId: v.variantId,
    title: v.title,
    sku: v.sku,
    barcode: v.barcode,
    price: v.price,
  }));
}

async function resolveMatchedSizesForGtin(input: {
  gtin: string;
  slug: string | null;
  matchedSizeEu?: string | null;
  matchedSizeUs?: string | null;
  gtinConfirmed?: boolean;
}): Promise<{
  matchedSizeEu: string | null;
  matchedSizeUs: string | null;
  gtinConfirmed: boolean;
}> {
  let matchedSizeEu = input.matchedSizeEu ?? null;
  let matchedSizeUs = input.matchedSizeUs ?? null;
  let gtinConfirmed = input.gtinConfirmed ?? false;

  // 1. Local KickDBVariant row — GTIN known even when sizeEu not backfilled yet.
  try {
    const local = await resolveGtinFromLocalSources(input.gtin);
    if (local?.source === "kickdb-variant") {
      gtinConfirmed = true;
      const localEu = sanitizeEuSizeForCreate(local.sizeEu);
      if (localEu) {
        matchedSizeEu = matchedSizeEu ?? localEu;
        matchedSizeUs = matchedSizeUs ?? local.sizeUs;
      }
    }
  } catch {
    // Non-fatal.
  }

  // 2. Live KickDB — fill size when DB row has GTIN but sizeEu null (common gap).
  if (input.slug && !matchedSizeEu) {
    const confirm = await inspectKickdbSlugForGtin(input.slug, input.gtin);
    matchedSizeEu = matchedSizeEu ?? confirm.matchedSizeEu;
    matchedSizeUs = matchedSizeUs ?? confirm.matchedSizeUs;
    if (confirm.gtinConfirmed) gtinConfirmed = true;
  }

  // 3. Other local sources (supplier, partner, …).
  if (!matchedSizeEu || !matchedSizeUs) {
    try {
      const local = await resolveGtinFromLocalSources(input.gtin);
      if (local && local.source !== "kickdb-variant") {
        matchedSizeEu = matchedSizeEu ?? sanitizeEuSizeForCreate(local.sizeEu);
        matchedSizeUs = matchedSizeUs ?? local.sizeUs;
      }
    } catch {
      // Non-fatal — KickDB API / DB lookup optional.
    }
  }

  if (matchedSizeEu && !isValidEuSizeForCreate(matchedSizeEu)) {
    matchedSizeEu = null;
  }

  return { matchedSizeEu, matchedSizeUs, gtinConfirmed };
}

/**
 * Full main.py catalog (all StockX sizes) then pick scanned EU size.
 * Falls back to single manual variant only if sync + pick both miss.
 */
async function syncFullCatalogAndResolveVariant(input: {
  gtin: string;
  slug: string | null;
  productId: string | null;
  sizeEu: string;
  sizeUs?: string | null;
  dryRun?: boolean;
  manualSellPrice?: number | null;
  manualCompareAtPrice?: number | null;
}): Promise<{
  productId: string;
  variantId: string;
  variantCreated: boolean;
  catalogSynced: boolean;
}> {
  let productId = String(input.productId ?? "").trim() || null;
  let catalogSynced = false;
  const slug = String(input.slug ?? "").trim();

  if (slug && !(input.dryRun ?? false)) {
    const sync = await createProductFullFlow(slug, { physicalGtin: input.gtin });
    if (sync.ok && sync.productId) {
      productId = sync.productId;
      catalogSynced = true;
    } else if (!productId) {
      throw new Error(`Sync catalogue Shopify échouée: ${sync.error ?? "inconnue"}`);
    }
  }

  if (!productId) {
    throw new Error("ProductId Shopify manquant — rescanner ou fournir un slug");
  }

  const variants = mapVariantChoices(await listProductVariants(productId));
  const picked = pickVariantBySize(variants, input.sizeEu, input.sizeUs ?? null);
  if (picked) {
    return {
      productId,
      variantId: picked.variantId,
      variantCreated: false,
      catalogSynced,
    };
  }

  const ensured = await ensureManualSizeVariant({
    productId,
    sizeTitle: input.sizeEu,
    gtin: input.gtin,
    dryRun: input.dryRun ?? false,
    manualSellPrice: input.manualSellPrice,
    manualCompareAtPrice: input.manualCompareAtPrice,
  });
  return {
    productId,
    variantId: ensured.variantId,
    variantCreated: ensured.created,
    catalogSynced,
  };
}

/** KickDB/local GTIN→size known: restock existing variant or create missing size — no UI. */
async function tryKickdbAutoRestock(input: {
  gtin: string;
  slug: string | null;
  productId: string;
  matchedSizeEu: string | null;
  matchedSizeUs: string | null;
  gtinConfirmed: boolean;
  quantity: number;
  locationId: string | null;
  dryRun?: boolean;
  warnings: string[];
  created?: boolean;
  salePrice?: number | null;
  compareAtPrice?: number | null;
}): Promise<ApplyScanResult | null> {
  if (!input.gtinConfirmed || !isValidEuSizeForCreate(input.matchedSizeEu)) return null;

  const variants = mapVariantChoices(await listProductVariants(input.productId));
  const suggested = pickVariantBySize(variants, input.matchedSizeEu, input.matchedSizeUs);

  let variantId: string;
  let variantCreated = input.created ?? false;

  try {
    if (suggested) {
      variantId = suggested.variantId;
    } else if (input.slug) {
      const resolved = await syncFullCatalogAndResolveVariant({
        gtin: input.gtin,
        slug: input.slug,
        productId: input.productId,
        sizeEu: input.matchedSizeEu!,
        sizeUs: input.matchedSizeUs,
        dryRun: input.dryRun,
        manualSellPrice: input.salePrice,
        manualCompareAtPrice: input.compareAtPrice,
      });
      variantId = resolved.variantId;
      if (resolved.catalogSynced) {
        input.warnings.push("Catalogue Shopify synchronisé (main.py — toutes tailles StockX)");
      }
      if (resolved.variantCreated) {
        variantCreated = true;
        input.warnings.push(
          `Variante EU ${formatSizeEuLabel(input.matchedSizeEu)} créée après sync (KickDB GTIN confirmé)`
        );
      }
    } else {
      const ensured = await ensureManualSizeVariant({
        productId: input.productId,
        sizeTitle: input.matchedSizeEu!,
        gtin: input.gtin,
        dryRun: input.dryRun ?? false,
        manualSellPrice: input.salePrice,
        manualCompareAtPrice: input.compareAtPrice,
      });
      variantId = ensured.variantId;
      if (ensured.created) {
        variantCreated = true;
        input.warnings.push(
          `Variante EU ${formatSizeEuLabel(input.matchedSizeEu)} créée (KickDB GTIN confirmé)`
        );
      }
    }
  } catch (err) {
    if (isManualPriceRequiredError(err)) {
      return buildManualPriceRequiredResult({
        gtin: input.gtin,
        slug: input.slug,
        productId: input.productId,
        matchedSizeEu: input.matchedSizeEu!,
        gtinConfirmed: input.gtinConfirmed,
        warnings: input.warnings,
      });
    }
    throw err;
  }

  if (input.dryRun) {
    return {
      ok: true,
      status: "restocked",
      gtin: input.gtin,
      slug: input.slug,
      shopify: { created: variantCreated, productId: input.productId },
      warnings: input.warnings,
    };
  }

  const resolution = await assignGtinToVariantExclusive({
    gtin: input.gtin,
    chosenVariantId: variantId,
  });
  input.warnings.push(...resolution.warnings);

  const restock = await restockShopifyVariantByGtin({
    gtin: input.gtin,
    quantity: input.quantity,
    salePrice: input.salePrice ?? null,
    dryRun: false,
    locationId: input.locationId ?? null,
    variantId,
    requireExplicitLocation: true,
  });
  if (!restock.found) {
    return {
      ok: false,
      status: "error",
      gtin: input.gtin,
      slug: input.slug,
      error: restock.warnings.join("; ") || "Restock auto KickDB échoué",
      warnings: [...input.warnings, ...restock.warnings],
    };
  }

  const db = await ensureStxSupplierForGtin(input.gtin, input.dryRun, input.warnings);
  await runPostRestockConvergence(input.gtin, input.dryRun, input.warnings);
  return {
    ok: true,
    status: "restocked",
    gtin: input.gtin,
    slug: input.slug,
    shopify: {
      created: variantCreated,
      productId: input.productId,
      restock,
    },
    db,
    warnings: [...input.warnings, ...restock.warnings],
  };
}

async function buildManualPriceRequiredResult(input: {
  gtin: string;
  slug: string | null;
  productId: string;
  matchedSizeEu: string;
  gtinConfirmed?: boolean;
  warnings: string[];
}): Promise<ApplyScanResult> {
  return {
    ok: false,
    status: "manual-price-required",
    gtin: input.gtin,
    slug: input.slug,
    shopify: { created: false, productId: input.productId },
    matchedSizeEu: input.matchedSizeEu,
    gtinConfirmed: input.gtinConfirmed ?? true,
    warnings: [
      ...input.warnings,
      `KickDB confirme EU ${formatSizeEuLabel(input.matchedSizeEu)} — aucun ask StockX, saisir le prix de vente`,
    ],
  };
}

async function buildSizeConfirmationResult(input: {
  gtin: string;
  slug: string | null;
  productId: string;
  created: boolean;
  variants: ShopifyVariantChoice[];
  matchedSizeEu: string | null;
  matchedSizeUs: string | null;
  gtinConfirmed: boolean;
  warnings: string[];
  db?: ApplyScanResult["db"];
}): Promise<ApplyScanResult> {
  const suggested = pickVariantBySize(input.variants, input.matchedSizeEu, input.matchedSizeUs);
  const kickdbSizeOptions = input.slug
    ? (await listKickdbGtinSizeOptions(input.slug, input.gtin)).filter((o) => o.sizeEu)
    : [];
  return {
    ok: false,
    status: "size-confirmation-required",
    gtin: input.gtin,
    slug: input.slug,
    shopify: { created: input.created, productId: input.productId },
    db: input.db,
    variantChoices: toPublicVariantChoices(input.variants),
    matchedSizeEu: input.matchedSizeEu,
    matchedSizeUs: input.matchedSizeUs,
    suggestedVariantId: suggested?.variantId ?? null,
    gtinConfirmed: input.gtinConfirmed,
    kickdbSizeOptions: kickdbSizeOptions.length ? kickdbSizeOptions : undefined,
    warnings: input.warnings,
  };
}

/**
 * KickDB/local hit but GTIN missing on Shopify barcode — check if the product
 * already exists (style SKU / slug) before offering full create (duplicate risk).
 */
async function finalizeCatalogLookup(
  gtin: string,
  catalog: CatalogHit
): Promise<ScanLookupResult> {
  const resolved = await resolveMatchedSizesForGtin({
    gtin,
    slug: catalog.slug,
    matchedSizeEu: catalog.matchedSizeEu,
    matchedSizeUs: catalog.matchedSizeUs,
    gtinConfirmed: catalog.gtinConfirmed,
  });

  const existing = await findExistingShopifyProductForCatalogIdentifier({
    slug: catalog.slug,
    styleSku: catalog.styleSku,
  });
  if (!existing) {
    return {
      status: "resolved",
      gtin,
      slug: catalog.slug,
      title: catalog.title,
      brand: catalog.brand,
      styleSku: catalog.styleSku,
      image: catalog.image,
      gtinConfirmed: resolved.gtinConfirmed,
      matchedSizeEu: resolved.matchedSizeEu,
      matchedSizeUs: resolved.matchedSizeUs,
    };
  }

  const variants = mapVariantChoices(await listProductVariants(existing.productId));
  const suggested = pickVariantBySize(
    variants,
    resolved.matchedSizeEu,
    resolved.matchedSizeUs
  );

  return {
    status: "shopify-exists-no-gtin",
    gtin,
    slug: catalog.slug,
    title: catalog.title,
    brand: catalog.brand,
    styleSku: catalog.styleSku,
    image: catalog.image,
    productId: existing.productId,
    gtinConfirmed: resolved.gtinConfirmed,
    matchedSizeEu: resolved.matchedSizeEu,
    matchedSizeUs: resolved.matchedSizeUs,
    suggestedVariantId: suggested?.variantId ?? null,
    variantChoices: variants.map((v) => ({
      variantId: v.variantId,
      title: v.title,
      sku: v.sku,
      barcode: v.barcode,
      price: v.price,
    })),
    matchedVia: existing.matchedVia,
  };
}

async function requireSizeConfirmationForExistingProduct(input: {
  gtin: string;
  slug: string | null;
  styleSku?: string | null;
  identifier?: string | null;
  matchedSizeEu?: string | null;
  matchedSizeUs?: string | null;
  gtinConfirmed?: boolean;
  quantity?: number;
  locationId?: string | null;
  dryRun?: boolean;
  salePrice?: number | null;
  compareAtPrice?: number | null;
  warnings?: string[];
}): Promise<ApplyScanResult | null> {
  const existing = await findExistingShopifyProductForCatalogIdentifier({
    slug: input.slug,
    styleSku: input.styleSku ?? input.identifier ?? null,
  });
  if (!existing) return null;

  const warnings = input.warnings ?? [];
  const variants = mapVariantChoices(await listProductVariants(existing.productId));
  const { matchedSizeEu, matchedSizeUs, gtinConfirmed } = await resolveMatchedSizesForGtin({
    gtin: input.gtin,
    slug: input.slug,
    matchedSizeEu: input.matchedSizeEu,
    matchedSizeUs: input.matchedSizeUs,
    gtinConfirmed: input.gtinConfirmed,
  });

  if (input.quantity != null && gtinConfirmed && isValidEuSizeForCreate(matchedSizeEu)) {
    const auto = await tryKickdbAutoRestock({
      gtin: input.gtin,
      slug: input.slug,
      productId: existing.productId,
      matchedSizeEu,
      matchedSizeUs,
      gtinConfirmed,
      quantity: input.quantity,
      locationId: input.locationId ?? null,
      dryRun: input.dryRun,
      salePrice: input.salePrice ?? null,
      compareAtPrice: input.compareAtPrice ?? null,
      warnings,
      created: false,
    });
    if (auto?.ok) return auto;
    if (auto && !auto.ok) return auto;
  }

  return await buildSizeConfirmationResult({
    gtin: input.gtin,
    slug: input.slug,
    productId: existing.productId,
    created: false,
    variants,
    matchedSizeEu,
    matchedSizeUs,
    gtinConfirmed,
    warnings: [
      ...warnings,
      gtinConfirmed && matchedSizeEu
        ? `Auto KickDB EU ${formatSizeEuLabel(matchedSizeEu)} échoué — choisir la taille manuellement`
        : `Produit déjà sur Shopify (${existing.matchedVia}) — GTIN absent, choisir la taille${
            matchedSizeEu ? ` (KickDB: EU ${formatSizeEuLabel(matchedSizeEu)})` : ""
          }`,
    ],
  });
}

/**
 * Step 1+2 of the cascade: where is this GTIN?
 * Read-only — never writes anywhere.
 */
export async function lookupScan(rawGtin: string): Promise<ScanLookupResult> {
  const gtin = cleanGtin(rawGtin);
  if (!gtin) {
    return { status: "not-found", gtin: rawGtin, message: "GTIN vide ou invalide" };
  }

  // 1. Shopify direct (barcode). Zero-padding tolerant (UPC-A vs EAN-13 on Shopify).
  const shopifyHit = await findShopifyVariantByGtin(gtin);
  if (shopifyHit.match) {
    const ambiguousMatches = shopifyHit.ambiguous
      ? await listShopifyVariantsByGtinDetailed(gtin)
      : undefined;
    return {
      status: "on-shopify",
      gtin,
      variant: shopifyHit.match,
      ambiguous: shopifyHit.ambiguous,
      ambiguousMatches,
    };
  }

  // 2. Local data sources (reliable): a prior import stored this GTIN somewhere.
  // KickDB's own search does NOT index GTINs, so our own tables are the real
  // GTIN -> product map. Check every catalog source before asking for manual input.
  try {
    const local = await resolveGtinFromLocalSources(gtin);
    if (local && (local.slug || local.styleSku)) {
      console.log("[RESTOCK][SCAN] GTIN resolved from local source", {
        gtin,
        source: local.source,
        slug: local.slug,
        styleSku: local.styleSku,
      });
      return finalizeCatalogLookup(gtin, {
        slug: (local.slug ?? local.styleSku) as string,
        title: local.title,
        brand: local.brand,
        styleSku: local.styleSku,
        image: local.image,
        gtinConfirmed: local.source === "kickdb-variant",
        matchedSizeEu: sanitizeEuSizeForCreate(local.sizeEu),
        matchedSizeUs: local.sizeUs,
      });
    }
  } catch (error) {
    console.error("[RESTOCK][SCAN] Local GTIN lookup failed", {
      gtin,
      error: error instanceof Error ? error.message : error,
    });
  }

  // 3. KickDB search by GTIN (best-effort; KickDB does not index GTINs today,
  // so this almost always misses — kept in case the API adds it later).
  try {
    const search = await searchStockxProducts(gtin);
    const hit = (search?.data ?? [])[0];
    const slug = pickStr((hit as any)?.slug, (hit as any)?.url_key, (hit as any)?.urlKey);
    if (hit && slug) {
      const confirm = await inspectKickdbSlugForGtin(slug, gtin);
      return finalizeCatalogLookup(gtin, {
        slug,
        title: pickStr((hit as any)?.title, (hit as any)?.name),
        brand: pickStr((hit as any)?.brand),
        styleSku: pickStr((hit as any)?.sku, (hit as any)?.style_id),
        image: pickStr((hit as any)?.image, (hit as any)?.image_url),
        gtinConfirmed: confirm.gtinConfirmed,
        matchedSizeEu: confirm.matchedSizeEu,
        matchedSizeUs: confirm.matchedSizeUs,
      });
    }
  } catch (error) {
    console.error("[RESTOCK][SCAN] KickDB GTIN search failed", {
      gtin,
      error: error instanceof Error ? error.message : error,
    });
  }

  // 4. Manual input required (box always has the style SKU printed on it)
  return {
    status: "not-found",
    gtin,
    message:
      "GTIN inconnu — entrer slug StockX ou SKU boîte",
  };
}

export type ApplyScanResult = {
  ok: boolean;
  status:
    | "restocked"
    | "size-confirmation-required"
    | "manual-price-required"
    | "gtin-confirmation-required"
    | "created-restocked"
    | "error";
  gtin: string;
  slug?: string | null;
  shopify?: {
    created: boolean;
    productId: string | null;
    restock?: RestockShopifyResult;
  };
  db?: {
    ok: boolean;
    importedVariantsCount?: number;
    errors?: string[];
    warnings?: string[];
  };
  /** For size-confirmation-required: created variants to choose from */
  variantChoices?: Array<{
    variantId: string;
    title: string | null;
    sku: string | null;
    barcode: string | null;
    price: string | null;
  }>;
  matchedSizeEu?: string | null;
  matchedSizeUs?: string | null;
  suggestedVariantId?: string | null;
  gtinConfirmed?: boolean;
  kickdbSizeOptions?: Array<{
    sizeEu: string | null;
    sizeUs: string | null;
    gtin: string | null;
    gtinMatch: boolean;
  }>;
  error?: string;
  warnings: string[];
};

async function listProductVariants(productId: string): Promise<
  Array<{
    variantId: string;
    title: string | null;
    sku: string | null;
    barcode: string | null;
    price: string | null;
    inventoryItemId: string | null;
  }>
> {
  const query = /* GraphQL */ `
    query RestockProductVariants($id: ID!) {
      product(id: $id) {
        variants(first: 50) {
          nodes {
            id
            title
            sku
            barcode
            price
            inventoryItem {
              id
            }
          }
        }
      }
    }
  `;
  const { data, errors } = await shopifyGraphQL<{
    product: {
      variants: {
        nodes: Array<{
          id: string;
          title: string | null;
          sku: string | null;
          barcode: string | null;
          price: string | null;
          inventoryItem: { id: string } | null;
        }>;
      };
    } | null;
  }>(query, { id: productId });
  if (errors?.length) {
    throw new Error(`Shopify product variants failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  return (data?.product?.variants?.nodes ?? []).map((node) => ({
    variantId: node.id,
    title: node.title,
    sku: node.sku,
    barcode: node.barcode,
    price: node.price,
    inventoryItemId: node.inventoryItem?.id ?? null,
  }));
}

/**
 * Full apply — used in three shapes:
 *  A. GTIN already on Shopify: `{ gtin, quantity }` -> direct restock.
 *  B. Resolved/manual identifier: `{ gtin, quantity, identifier }` ->
 *     GTIN already on Shopify? just bump Bussigny stock (+ DB export sync),
 *     NEVER recreate. Only when GTIN is absent: create Shopify (Python) +
 *     DB (STX import) -> restock by GTIN -> if barcode mismatch, variant guard.
 *  C. Size confirmed: `{ gtin, quantity, identifier, confirmVariantId }` ->
 *     write scanned GTIN as barcode on chosen variant -> stock at Bussigny.
 */
export async function applyScanRestock(input: {
  gtin: string;
  quantity: number;
  identifier?: string | null;
  confirmVariantId?: string | null;
  /** Operator-typed EU size — create variant if missing, then GTIN + restock. */
  confirmManualSizeEu?: string | null;
  confirmProductId?: string | null;
  /** @deprecated Prefer confirmManualSizeEu */
  ensureMissingSize?: boolean;
  salePrice?: number | null;
  compareAtPrice?: number | null;
  dryRun?: boolean;
  /** Preferred physical Shopify location id; validated against locationConfig. */
  locationId?: string | null;
}): Promise<ApplyScanResult> {
  const gtin = cleanGtin(input.gtin);
  const warnings: string[] = [];
  if (!gtin) {
    return { ok: false, status: "error", gtin: input.gtin, error: "GTIN vide", warnings };
  }

  // --- Shape D: operator types physical EU size → create variant if needed ---
  const manualSize = String(input.confirmManualSizeEu ?? "").trim();
  if (manualSize) {
    if (!isValidEuSizeForCreate(manualSize)) {
      return {
        ok: false,
        status: "error",
        gtin,
        error: `Taille EU invalide: "${manualSize}"`,
        warnings,
      };
    }

    let productId = String(input.confirmProductId ?? "").trim() || null;
    let slug: string | null = null;
    const identifier = String(input.identifier ?? "").trim();
    if (identifier) {
      try {
        const resolved = await resolveProductIdentifier(identifier);
        slug = resolved.slug ?? identifier;
      } catch {
        slug = identifier;
      }
    }
    if (!productId && identifier) {
      const existing = await findExistingShopifyProductForCatalogIdentifier({
        slug,
        styleSku: identifier,
      });
      productId = existing?.productId ?? null;
    }
    if (!productId && !slug) {
      return {
        ok: false,
        status: "error",
        gtin,
        error: "confirmProductId ou identifier (slug/SKU) requis",
        warnings,
      };
    }

    try {
      const resolved = await syncFullCatalogAndResolveVariant({
        gtin,
        slug,
        productId,
        sizeEu: manualSize,
        dryRun: input.dryRun ?? false,
        manualSellPrice: input.salePrice,
        manualCompareAtPrice: input.compareAtPrice,
      });
      productId = resolved.productId;
      if (resolved.catalogSynced) {
        warnings.push("Catalogue Shopify synchronisé (main.py — toutes tailles StockX)");
      }
      if (resolved.variantCreated) {
        warnings.push(`Variante EU ${manualSize} créée (absente après sync catalogue)`);
      }

      if (input.dryRun) {
        return {
          ok: true,
          status: "restocked",
          gtin,
          shopify: { created: resolved.variantCreated, productId },
          warnings,
        };
      }

      const resolution = await assignGtinToVariantExclusive({
        gtin,
        chosenVariantId: resolved.variantId,
      });
      warnings.push(...resolution.warnings);

      const restock = await restockShopifyVariantByGtin({
        gtin,
        quantity: input.quantity,
        salePrice: input.salePrice ?? null,
        dryRun: false,
        locationId: input.locationId ?? null,
        variantId: resolved.variantId,
        requireExplicitLocation: true,
      });
      if (!restock.found) {
        return {
          ok: false,
          status: "error",
          gtin,
          error: restock.warnings.join("; ") || "Restock failed after catalog sync",
          warnings: [...warnings, ...restock.warnings],
        };
      }

      const db = await ensureStxSupplierForGtin(gtin, input.dryRun, warnings);
      await runPostRestockConvergence(gtin, input.dryRun, warnings);
      return {
        ok: true,
        status: "restocked",
        gtin,
        shopify: { created: resolved.variantCreated, productId, restock },
        db,
        warnings: [...warnings, ...restock.warnings],
      };
    } catch (error: any) {
      if (isManualPriceRequiredError(error)) {
        return buildManualPriceRequiredResult({
          gtin,
          slug,
          productId: productId ?? "",
          matchedSizeEu: manualSize,
          gtinConfirmed: true,
          warnings,
        });
      }
      return {
        ok: false,
        status: "error",
        gtin,
        error: error?.message ?? "Sync catalogue + restock échoué",
        warnings,
      };
    }
  }

  // --- Shape E: legacy sync via Python physical GTIN (KickDB) ---
  if (input.ensureMissingSize) {
    const identifier = String(input.identifier ?? "").trim();
    if (!identifier) {
      return {
        ok: false,
        status: "error",
        gtin,
        error: "ensureMissingSize nécessite identifier (slug/SKU)",
        warnings,
      };
    }

    let slug: string | null = null;
    try {
      const resolved = await resolveProductIdentifier(identifier);
      slug = resolved.slug ?? identifier;
    } catch {
      slug = identifier;
    }

    const sync = await createProductFullFlow(slug, { physicalGtin: gtin });
    if (!sync.ok || !sync.productId) {
      return {
        ok: false,
        status: "error",
        gtin,
        slug,
        error: `Sync Shopify échouée: ${sync.error ?? "inconnue"}`,
        warnings,
      };
    }

    const variants = mapVariantChoices(await listProductVariants(sync.productId));
    const { matchedSizeEu, matchedSizeUs, gtinConfirmed } = await resolveMatchedSizesForGtin({
      gtin,
      slug,
    });
    const suggested = pickVariantBySize(variants, matchedSizeEu, matchedSizeUs);

    if (suggested) {
      return applyScanRestock({
        ...input,
        ensureMissingSize: false,
        identifier,
        confirmVariantId: suggested.variantId,
      });
    }

    return await buildSizeConfirmationResult({
      gtin,
      slug,
      productId: sync.productId,
      created: sync.action === "create",
      variants,
      matchedSizeEu,
      matchedSizeUs,
      gtinConfirmed,
      warnings: [
        ...warnings,
        matchedSizeEu
          ? `Taille KickDB EU ${formatSizeEuLabel(matchedSizeEu)} toujours absente après sync — choisir manuellement ou revérifier le produit`
          : "Sync terminée mais taille scannée introuvable — choisir manuellement",
      ],
    });
  }

  // --- Shape C: variant confirmed (size after create OR GTIN disambiguation) ---
  if (input.confirmVariantId) {
    try {
      const resolution = await assignGtinToVariantExclusive({
        gtin,
        chosenVariantId: input.confirmVariantId,
      });
      warnings.push(...resolution.warnings);

      const restock = await restockShopifyVariantByGtin({
        gtin,
        quantity: input.quantity,
        salePrice: input.salePrice ?? null,
        dryRun: input.dryRun ?? false,
        locationId: input.locationId ?? null,
        variantId: input.confirmVariantId,
        requireExplicitLocation: true,
      });
      if (!restock.found) {
        return {
          ok: false,
          status: "error",
          gtin,
          error: restock.warnings.join("; ") || "Restock failed after variant confirmation",
          warnings: [...warnings, ...restock.warnings],
        };
      }

      const productId = restock.variant?.productId ?? null;
      const db = await ensureStxSupplierForGtin(gtin, input.dryRun, warnings);
      await runPostRestockConvergence(gtin, input.dryRun, warnings);
      return {
        ok: true,
        status: "restocked",
        gtin,
        shopify: { created: false, productId, restock },
        db,
        warnings: [...warnings, ...restock.warnings],
      };
    } catch (error: any) {
      return {
        ok: false,
        status: "error",
        gtin,
        error: error?.message ?? "Confirmation variante échouée",
        warnings,
      };
    }
  }

  // --- Shape A: direct restock when GTIN already on Shopify ---
  if (!input.identifier) {
    const hit = await findShopifyVariantByGtin(gtin);
    if (hit.ambiguous) {
      const choices = await listShopifyVariantsByGtinDetailed(gtin);
      return {
        ok: false,
        status: "gtin-confirmation-required",
        gtin,
        variantChoices: choices.map((v) => ({
          variantId: v.variantId,
          title: v.productTitle,
          sku: v.sku,
          barcode: v.barcode,
          price: v.price != null ? v.price.toFixed(2) : null,
          compareAtPrice: v.compareAtPrice != null ? v.compareAtPrice.toFixed(2) : null,
          productHandle: v.productHandle,
        })),
        warnings: [
          `GTIN ${gtin} partagé par ${choices.length} variantes Shopify — choisir la bonne paire`,
        ],
      };
    }

    const restock = await restockShopifyVariantByGtin({
      gtin,
      quantity: input.quantity,
      salePrice: input.salePrice ?? null,
      dryRun: input.dryRun ?? false,
      locationId: input.locationId ?? null,
      requireExplicitLocation: true,
    });
    if (restock.found) {
      const outWarnings = [...warnings, ...restock.warnings];
      const db = await ensureStxSupplierForGtin(gtin, input.dryRun, outWarnings);
      await runPostRestockConvergence(gtin, input.dryRun, outWarnings);
      return {
        ok: true,
        status: "restocked",
        gtin,
        shopify: { created: false, productId: restock.variant?.productId ?? null, restock },
        db,
        warnings: outWarnings,
      };
    }
    return {
      ok: false,
      status: "error",
      gtin,
      error: "GTIN pas sur Shopify — fournir un identifiant (slug/SKU) pour créer le produit",
      warnings,
    };
  }

  // --- Shape B: identifier provided (scan/return where product may need creating) ---
  // KEY PRINCIPLE: Shopify link = GTIN + Bussigny location. The product almost
  // always already exists on Shopify — in that case we ONLY bump Bussigny stock
  // and never recreate. Full product creation is the exception (GTIN absent).

  // B.0 — Resolve identifier -> canonical slug. Best-effort: the slug is only
  // needed for the DB export import. A failure here must NOT block the Shopify
  // Bussigny restock when the product already exists.
  let slug: string | null = null;
  let slugResolveError: string | null = null;
  try {
    const resolved = await resolveProductIdentifier(String(input.identifier).trim());
    if (resolved.slug) {
      slug = resolved.slug;
    } else {
      slugResolveError = resolved.error ?? "slug introuvable";
    }
  } catch (error: any) {
    slugResolveError = error?.message ?? String(error);
  }

  // B.1 — DB upsert for Galaxus/Decathlon export (THE_ row). Independent of
  // whether the product exists on Shopify. Non-fatal; skipped without a slug.
  async function runDbImport(): Promise<ApplyScanResult["db"]> {
    // Manual-only GTINs (wrong KickDB match / Shopify-only stock) must never
    // get an STX supplier row.
    if (isManualOnlyGtin(gtin)) {
      warnings.push(
        `Import DB ignoré: GTIN ${gtin} est manuel-only (pas de StockX / marketplace auto).`
      );
      return { ok: true, importedVariantsCount: 0, errors: [], warnings: ["manual_only_gtin"] };
    }
    if (!slug) {
      warnings.push(
        `Import DB (Galaxus/Decathlon) ignoré: slug non résolu (${slugResolveError ?? "inconnu"})`
      );
      return { ok: false, errors: [`slug_unresolved: ${slugResolveError ?? "unknown"}`] };
    }
    try {
      // Scan intake always force-imports: if the operator physically has the
      // item on the shelf, we want a supplier row so marketplace feeds can
      // publish it, regardless of the express-price filter (clothing, niche
      // sizes, low-ask variants — all valid to sell when we own stock).
      const imported = await importStxProductByInput(slug, {
        forceImport: true,
        targetGtin: gtin,
      });
      if (!imported.ok) {
        warnings.push(
          `Import DB (Galaxus/Decathlon) échoué: ${imported.errors.join("; ") || "raison inconnue"}`
        );
      }
      return {
        ok: imported.ok,
        importedVariantsCount: imported.importedVariantsCount,
        errors: imported.errors,
        warnings: imported.warnings,
      };
    } catch (error: any) {
      warnings.push(`Import DB (Galaxus/Decathlon) erreur: ${error?.message ?? error}`);
      return { ok: false, errors: [error?.message ?? String(error)] };
    }
  }

  // B.2 — GTIN already on Shopify? Just adjust Bussigny stock, NEVER recreate.
  const existing = await restockShopifyVariantByGtin({
    gtin,
    quantity: input.quantity,
    salePrice: input.salePrice ?? null,
    dryRun: input.dryRun ?? false,
    locationId: input.locationId ?? null,
    requireExplicitLocation: true,
  });
  if (existing.found) {
    const dbExisting = await runDbImport();
    const outWarnings = [...warnings, ...existing.warnings];
    await runPostRestockConvergence(gtin, input.dryRun, outWarnings);
    return {
      ok: true,
      status: "restocked",
      gtin,
      shopify: { created: false, productId: existing.variant?.productId ?? null, restock: existing },
      db: dbExisting,
      warnings: outWarnings,
    };
  }

  // B.3 — GTIN absent on Shopify: block duplicate create if product already exists.
  const duplicateGuard = await requireSizeConfirmationForExistingProduct({
    gtin,
    slug,
    styleSku: String(input.identifier ?? "").trim() || null,
    identifier: input.identifier ?? null,
    quantity: input.quantity,
    locationId: input.locationId ?? null,
    dryRun: input.dryRun,
    salePrice: input.salePrice ?? null,
    compareAtPrice: input.compareAtPrice ?? null,
    warnings,
  });
  if (duplicateGuard) {
    duplicateGuard.db = await runDbImport();
    return duplicateGuard;
  }

  if (!slug) {
    return {
      ok: false,
      status: "error",
      gtin,
      error: `GTIN absent sur Shopify et identifiant non résolu (${slugResolveError ?? "inconnu"}) — impossible de créer`,
      warnings,
    };
  }

  // B.4 — Shopify full create (Python pipeline) — only when product truly absent.
  const created = await createProductFullFlow(slug, { physicalGtin: gtin });
  if (!created.ok) {
    return {
      ok: false,
      status: "error",
      gtin,
      slug,
      error: `Création Shopify échouée: ${created.error ?? "inconnue"}`,
      warnings,
    };
  }

  // B.5 — DB create for Galaxus/Decathlon export (non-fatal on failure)
  const db = await runDbImport();

  // B.6 — Restock by scanned GTIN (now that the product exists)
  const restock = await restockShopifyVariantByGtin({
    gtin,
    quantity: input.quantity,
    salePrice: input.salePrice ?? null,
    dryRun: input.dryRun ?? false,
    locationId: input.locationId ?? null,
    requireExplicitLocation: true,
  });
  if (restock.found) {
    const outWarnings = [...warnings, ...restock.warnings];
    await runPostRestockConvergence(gtin, input.dryRun, outWarnings);
    return {
      ok: true,
      status: "created-restocked",
      gtin,
      slug,
      shopify: { created: created.action === "create", productId: created.productId, restock },
      db,
      warnings: outWarnings,
    };
  }

  // B.7 — Guard: scanned GTIN matches no created barcode -> size confirmation
  if (!created.productId) {
    return {
      ok: false,
      status: "error",
      gtin,
      slug,
      db,
      error: "Produit créé mais id Shopify manquant",
      warnings,
    };
  }
  const variants = mapVariantChoices(await listProductVariants(created.productId));
  const { matchedSizeEu, matchedSizeUs, gtinConfirmed } = await resolveMatchedSizesForGtin({
    gtin,
    slug,
  });
  const auto = await tryKickdbAutoRestock({
    gtin,
    slug,
    productId: created.productId,
    matchedSizeEu,
    matchedSizeUs,
    gtinConfirmed,
    quantity: input.quantity,
    locationId: input.locationId ?? null,
    dryRun: input.dryRun,
    salePrice: input.salePrice ?? null,
    compareAtPrice: input.compareAtPrice ?? null,
    warnings,
    created: created.action === "create",
  });
  if (auto) {
    auto.db = db;
    return auto;
  }
  return await buildSizeConfirmationResult({
    gtin,
    slug,
    productId: created.productId,
    created: created.action === "create",
    variants,
    matchedSizeEu,
    matchedSizeUs,
    gtinConfirmed,
    db,
    warnings: [
      ...warnings,
      `GTIN scanné ${gtin} ne matche aucun barcode — confirmer la taille manuellement`,
    ],
  });
}

/**
 * Convenience for direct add-stock when the size is known by EU title
 * (used by return flows, not the scan UI).
 */
export async function addStockAtBussignyBySize(input: {
  productId: string;
  sizeEu: string;
  quantity: number;
  gtinToWrite?: string | null;
}): Promise<{ ok: boolean; variantId?: string; error?: string }> {
  const variants = await listProductVariants(input.productId);
  const match = variants.find((v) => sizeTitlesMatch(v.title, input.sizeEu));
  if (!match) {
    return { ok: false, error: `Taille "${input.sizeEu}" introuvable sur le produit` };
  }
  if (!match.inventoryItemId) {
    return { ok: false, error: "Variante sans inventory item" };
  }

  if (input.gtinToWrite) {
    await setVariantBarcode({
      productId: input.productId,
      variantId: match.variantId,
      barcode: cleanGtin(input.gtinToWrite),
    });
  }

  const { locationId } = await resolveBussignyLocationId();
  if (!locationId) {
    return { ok: false, error: "Location Bussigny introuvable" };
  }
  await activateInventoryAtLocation({
    inventoryItemId: match.inventoryItemId,
    locationId,
  });
  await adjustInventoryAtLocation({
    inventoryItemId: match.inventoryItemId,
    locationId,
    delta: input.quantity,
  });
  return { ok: true, variantId: match.variantId };
}
