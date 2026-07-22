import { searchStockxProducts, fetchStockxProductByIdOrSlugRaw, extractVariantGtin } from "@/galaxus/kickdb/client";
import { importStxProductByInput } from "@/galaxus/stx/importProduct";
import {
  createProductFullFlow,
  resolveProductIdentifier,
} from "@/shopify/restock/createProductFullFlow";
import {
  activateInventoryAtLocation,
  adjustInventoryAtLocation,
  findShopifyVariantByGtin,
  resolveBussignyLocationId,
  restockShopifyVariantByGtin,
  setVariantBarcode,
  type RestockShopifyResult,
  type ShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";
import { isManualOnlyGtin } from "@/shopify/inventory/manualOnlyGtins";
import { convergeVariant } from "@/shopify/inventory/convergence";

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

    const imported = await importStxProductByInput(slug, { forceImport: true });
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
      status: "not-found";
      gtin: string;
      message: string;
    };

function cleanGtin(value: string): string {
  return String(value ?? "").replace(/\D/g, "").trim();
}

function pickStr(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** GTIN digit-comparison tolerant to leading zeros (UPC-A vs EAN-13). */
function gtinEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = cleanGtin(String(a ?? "")).replace(/^0+/, "");
  const cb = cleanGtin(String(b ?? "")).replace(/^0+/, "");
  return Boolean(ca) && ca === cb;
}

async function inspectKickdbSlugForGtin(
  slug: string,
  gtin: string
): Promise<{ gtinConfirmed: boolean; matchedSizeEu: string | null; matchedSizeUs: string | null }> {
  try {
    const { product } = await fetchStockxProductByIdOrSlugRaw(slug);
    const variants = Array.isArray((product as any)?.variants) ? (product as any).variants : [];
    for (const variant of variants) {
      const vGtin = extractVariantGtin(variant);
      if (vGtin && gtinEquals(vGtin, gtin)) {
        return {
          gtinConfirmed: true,
          matchedSizeEu: pickStr(variant?.size_eu),
          matchedSizeUs: pickStr(variant?.size_us, variant?.size),
        };
      }
    }
  } catch {
    // Non-fatal: detail fetch failure just means we cannot confirm the GTIN.
  }
  return { gtinConfirmed: false, matchedSizeEu: null, matchedSizeUs: null };
}

/** GTIN match candidates tolerant to UPC-A/EAN-13/GTIN-14 zero-padding. */
function gtinCandidates(rawGtin: string): string[] {
  const clean = cleanGtin(rawGtin);
  if (!clean) return [];
  const stripped = clean.replace(/^0+/, "");
  const set = new Set<string>([clean, stripped]);
  for (const base of [clean, stripped]) {
    if (!base) continue;
    for (const len of [12, 13, 14]) {
      if (base.length <= len) set.add(base.padStart(len, "0"));
    }
  }
  return [...set].filter(Boolean);
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

/**
 * Step 1+2 of the cascade: where is this GTIN?
 * Read-only — never writes anywhere.
 */
export async function lookupScan(rawGtin: string): Promise<ScanLookupResult> {
  const gtin = cleanGtin(rawGtin);
  if (!gtin) {
    return { status: "not-found", gtin: rawGtin, message: "GTIN vide ou invalide" };
  }

  // 1. Shopify direct (barcode). Try zero-padding candidates so a scanner that
  // emits a UPC-A/EAN-13 variant still matches an existing Shopify barcode.
  for (const candidate of gtinCandidates(gtin)) {
    const shopifyHit = await findShopifyVariantByGtin(candidate);
    if (shopifyHit.match) {
      return {
        status: "on-shopify",
        gtin,
        variant: shopifyHit.match,
        ambiguous: shopifyHit.ambiguous,
      };
    }
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
      return {
        status: "resolved",
        gtin,
        // Downstream `identifier`: prefer a real StockX slug, else the style SKU
        // (createProductFullFlow / resolveProductIdentifier both accept a SKU).
        slug: (local.slug ?? local.styleSku) as string,
        title: local.title,
        brand: local.brand,
        styleSku: local.styleSku,
        image: local.image,
        gtinConfirmed: true,
        matchedSizeEu: local.sizeEu,
        matchedSizeUs: local.sizeUs,
      };
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
      if (confirm.gtinConfirmed) {
        return {
          status: "resolved",
          gtin,
          slug,
          title: pickStr((hit as any)?.title, (hit as any)?.name),
          brand: pickStr((hit as any)?.brand),
          styleSku: pickStr((hit as any)?.sku, (hit as any)?.style_id),
          image: pickStr((hit as any)?.image, (hit as any)?.image_url),
          ...confirm,
        };
      }
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
    message: "GTIN inconnu (pas sur Shopify, pas en base) — scanner/entrer le SKU de la boîte",
  };
}

export type ApplyScanResult = {
  ok: boolean;
  status:
    | "restocked"
    | "size-confirmation-required"
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

function normalizeSizeTitle(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[wy]$/i, "")
    .replace(/\s+/g, " ")
    .trim();
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
  salePrice?: number | null;
  dryRun?: boolean;
  /** Preferred physical Shopify location id; validated against locationConfig. */
  locationId?: string | null;
}): Promise<ApplyScanResult> {
  const gtin = cleanGtin(input.gtin);
  const warnings: string[] = [];
  if (!gtin) {
    return { ok: false, status: "error", gtin: input.gtin, error: "GTIN vide", warnings };
  }

  // --- Shape C: size confirmed, write barcode then stock ---
  if (input.confirmVariantId) {
    try {
      const detailQuery = /* GraphQL */ `
        query RestockConfirmVariant($id: ID!) {
          productVariant(id: $id) {
            id
            product {
              id
            }
            inventoryItem {
              id
            }
          }
        }
      `;
      const { data, errors } = await shopifyGraphQL<{
        productVariant: {
          id: string;
          product: { id: string } | null;
          inventoryItem: { id: string } | null;
        } | null;
      }>(detailQuery, { id: input.confirmVariantId });
      if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
      const node = data?.productVariant;
      if (!node?.product?.id || !node.inventoryItem?.id) {
        return {
          ok: false,
          status: "error",
          gtin,
          error: "Variante confirmée introuvable sur Shopify",
          warnings,
        };
      }

      await setVariantBarcode({
        productId: node.product.id,
        variantId: node.id,
        barcode: gtin,
      });
      warnings.push(`Barcode ${gtin} écrit sur la variante confirmée`);

      const restock = await restockShopifyVariantByGtin({
        gtin,
        quantity: input.quantity,
        salePrice: input.salePrice ?? null,
        dryRun: input.dryRun ?? false,
        locationId: input.locationId ?? null,
      });
      return {
        ok: restock.found,
        status: "restocked",
        gtin,
        shopify: { created: false, productId: node.product.id, restock },
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
    const restock = await restockShopifyVariantByGtin({
      gtin,
      quantity: input.quantity,
      salePrice: input.salePrice ?? null,
      dryRun: input.dryRun ?? false,
      locationId: input.locationId ?? null,
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
      const imported = await importStxProductByInput(slug, { forceImport: true });
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

  // B.3 — GTIN absent on Shopify: creation needs a slug. Without one, bail.
  if (!slug) {
    return {
      ok: false,
      status: "error",
      gtin,
      error: `GTIN absent sur Shopify et identifiant non résolu (${slugResolveError ?? "inconnu"}) — impossible de créer`,
      warnings,
    };
  }

  // B.4 — Shopify full create (Python pipeline) — only reached when GTIN absent.
  const created = await createProductFullFlow(slug);
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
  const variants = await listProductVariants(created.productId);
  return {
    ok: false,
    status: "size-confirmation-required",
    gtin,
    slug,
    shopify: { created: created.action === "create", productId: created.productId },
    db,
    variantChoices: variants.map((v) => ({
      variantId: v.variantId,
      title: v.title,
      sku: v.sku,
      barcode: v.barcode,
      price: v.price,
    })),
    warnings: [
      ...warnings,
      `GTIN scanné ${gtin} ne matche aucun barcode du produit "${slug}" — confirmer la taille (data KickDB possiblement fausse)`,
    ],
  };
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
  const wanted = normalizeSizeTitle(input.sizeEu);
  const match = variants.find((v) => normalizeSizeTitle(v.title) === wanted);
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
