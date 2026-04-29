import { prisma } from "@/app/lib/prisma";
import { attachAvailableStock } from "@/inventory/availableStock";
import {
  classifyProductPricingKind,
  computeChannelVariantPrice,
} from "@/inventory/pricingPolicy";
import {
  archiveProduct,
  createProductWithVariant,
  describeGtinSkuConflict,
  findShopifyVariantsByGtin,
  findVariantBySku,
  getPrimaryLocationId,
  setInventoryQuantity,
  updateVariantPricingAndIdentity,
} from "./graphql";
import type {
  ShopifyCatalogCandidate,
  ShopifyCatalogSyncOptions,
  ShopifyCatalogSyncResult,
  ShopifyCatalogSyncRowResult,
} from "./types";

const ELIGIBLE_MAPPING_STATUSES = ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] as const;

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function resolveTitle(mapping: any): string {
  return (
    String(
      mapping?.kickdbVariant?.product?.name ??
        mapping?.supplierVariant?.supplierProductName ??
        mapping?.providerKey ??
        ""
    ).trim() || `Variant ${String(mapping?.providerKey ?? "").trim()}`
  );
}

function resolveBrand(mapping: any): string | null {
  const raw = String(
    mapping?.supplierVariant?.supplierBrand ?? mapping?.kickdbVariant?.product?.brand ?? ""
  ).trim();
  return raw || null;
}

function resolveBasePrice(mapping: any): number | null {
  const manualLock = Boolean(mapping?.supplierVariant?.manualLock);
  const manualPrice = decimalToNumber(mapping?.supplierVariant?.manualPrice);
  if (manualLock && manualPrice) return manualPrice;
  return decimalToNumber(mapping?.supplierVariant?.price);
}

async function loadCandidates(options: ShopifyCatalogSyncOptions): Promise<ShopifyCatalogCandidate[]> {
  const limitRaw = Number(options.limit ?? 500);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 5000) : 500;
  const offsetRaw = Number(options.offset ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;
  const supplierKey = String(options.supplierKey ?? "").trim().toLowerCase();
  const inStockOnly = options.inStockOnly ?? true;
  const providerKeys = Array.from(
    new Set((options.providerKeys ?? []).map((value) => String(value).trim()).filter(Boolean))
  );

  const prismaAny = prisma as any;
  const where: Record<string, unknown> = {
    status: { in: ELIGIBLE_MAPPING_STATUSES as unknown as string[] },
    providerKey: providerKeys.length > 0 ? { in: providerKeys } : { not: null },
    supplierVariantId: { not: null },
  };
  if (supplierKey) {
    where.OR = [
      { supplierVariantId: { startsWith: `${supplierKey}_` } },
      { supplierVariantId: { startsWith: `${supplierKey}:` } },
      { providerKey: { startsWith: `${supplierKey.toUpperCase()}_` } },
    ];
  }

  const mappings = await prismaAny.variantMapping.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    skip: offset,
    take: limit,
    select: {
      providerKey: true,
      gtin: true,
      supplierVariantId: true,
      supplierVariant: {
        select: {
          supplierVariantId: true,
          price: true,
          manualPrice: true,
          manualLock: true,
          stock: true,
          manualStock: true,
          sizeRaw: true,
          sizeNormalized: true,
          supplierBrand: true,
          supplierProductName: true,
        },
      },
      kickdbVariant: {
        select: {
          sizeUs: true,
          sizeEu: true,
          product: {
            select: {
              name: true,
              brand: true,
            },
          },
        },
      },
    },
  });

  const variants = mappings
    .map((mapping: any) => mapping?.supplierVariant)
    .filter((variant: any) => Boolean(variant));
  const stockBySupplierVariantId = await attachAvailableStock(variants);

  const candidates: ShopifyCatalogCandidate[] = [];
  for (const mapping of mappings) {
    const providerKey = String(mapping?.providerKey ?? "").trim();
    const supplierVariantId = String(mapping?.supplierVariant?.supplierVariantId ?? "").trim();
    if (!providerKey || !supplierVariantId) continue;

    const basePrice = resolveBasePrice(mapping);
    if (!basePrice) continue;

    const pricingKind = classifyProductPricingKind({
      title: resolveTitle(mapping),
      sizeRaw: mapping?.supplierVariant?.sizeRaw ?? null,
      sizeNormalized: mapping?.supplierVariant?.sizeNormalized ?? null,
      sizeEu: mapping?.kickdbVariant?.sizeEu ?? null,
      sizeUs: mapping?.kickdbVariant?.sizeUs ?? null,
    });

    const targetPrice = computeChannelVariantPrice({
      channel: "SHOPIFY",
      basePrice,
      classification: pricingKind,
    });
    if (!targetPrice) continue;

    const availableStock =
      stockBySupplierVariantId.get(supplierVariantId) ??
      Math.max(0, Number.parseInt(String(mapping?.supplierVariant?.stock ?? 0), 10) || 0);
    if (inStockOnly && availableStock <= 0) continue;

    candidates.push({
      providerKey,
      supplierVariantId,
      gtin: mapping?.gtin ? String(mapping.gtin) : null,
      title: resolveTitle(mapping),
      brand: resolveBrand(mapping),
      sizeRaw: mapping?.supplierVariant?.sizeRaw ?? null,
      sizeNormalized: mapping?.supplierVariant?.sizeNormalized ?? null,
      sizeEu: mapping?.kickdbVariant?.sizeEu ?? null,
      sizeUs: mapping?.kickdbVariant?.sizeUs ?? null,
      basePrice,
      targetPrice,
      availableStock,
      pricingKind,
    });
  }

  return candidates;
}

async function upsertListingState(input: {
  providerKey: string;
  supplierVariantId: string;
  gtin: string | null;
  productId?: string | null;
  variantId?: string | null;
  inventoryItemId?: string | null;
  locationId?: string | null;
  stock: number;
  price: number;
  status: string;
  soldOutAt?: Date | null;
  archivedAt?: Date | null;
  lastError?: string | null;
  metadataJson?: unknown;
}) {
  const prismaAny = prisma as any;
  const listingDelegate = prismaAny.channelListingState;
  if (!listingDelegate?.upsert) {
    return null;
  }
  return listingDelegate.upsert({
    where: {
      channel_providerKey: {
        channel: "SHOPIFY",
        providerKey: input.providerKey,
      },
    },
    create: {
      channel: "SHOPIFY",
      providerKey: input.providerKey,
      supplierVariantId: input.supplierVariantId,
      gtin: input.gtin,
      externalProductId: input.productId ?? null,
      externalVariantId: input.variantId ?? null,
      externalInventoryItemId: input.inventoryItemId ?? null,
      externalLocationId: input.locationId ?? null,
      lastPushedStock: input.stock,
      lastPushedPrice: input.price,
      lastSyncedAt: new Date(),
      status: input.status,
      soldOutAt: input.soldOutAt ?? null,
      archivedAt: input.archivedAt ?? null,
      lastError: input.lastError ?? null,
      metadataJson: input.metadataJson ?? null,
    },
    update: {
      supplierVariantId: input.supplierVariantId,
      gtin: input.gtin,
      externalProductId: input.productId ?? undefined,
      externalVariantId: input.variantId ?? undefined,
      externalInventoryItemId: input.inventoryItemId ?? undefined,
      externalLocationId: input.locationId ?? undefined,
      lastPushedStock: input.stock,
      lastPushedPrice: input.price,
      lastSyncedAt: new Date(),
      status: input.status,
      soldOutAt: input.soldOutAt ?? undefined,
      archivedAt: input.archivedAt ?? undefined,
      lastError: input.lastError ?? undefined,
      metadataJson: input.metadataJson ?? undefined,
    },
  });
}

export async function syncShopifyCatalog(
  options: ShopifyCatalogSyncOptions = {}
): Promise<ShopifyCatalogSyncResult> {
  const dryRun = options.dryRun ?? String(process.env.SHOPIFY_CATALOG_DRY_RUN ?? "1") !== "0";
  const missingOnly = options.missingOnly ?? true;
  const checkExistingOnDryRun = options.checkExistingOnDryRun ?? true;
  const candidates = await loadCandidates(options);
  const providerKeys = candidates.map((candidate) => candidate.providerKey);
  const prismaAny = prisma as any;
  const listingDelegate = prismaAny.channelListingState;
  const canReadListingState = Boolean(listingDelegate?.findMany);
  const listingRows =
    providerKeys.length > 0 && canReadListingState
      ? await listingDelegate.findMany({
          where: { channel: "SHOPIFY", providerKey: { in: providerKeys } },
        })
      : [];
  const listingByProviderKey = new Map<string, any>(
    (listingRows ?? []).map((row: any) => [String(row.providerKey), row])
  );

  const rows: ShopifyCatalogSyncRowResult[] = [];
  let created = 0;
  let updated = 0;
  let soldOut = 0;
  let skipped = 0;
  let errors = 0;

  const locationId = dryRun ? null : await getPrimaryLocationId();

  for (const candidate of candidates) {
    try {
      const listing = listingByProviderKey.get(candidate.providerKey) ?? null;
      let action: ShopifyCatalogSyncRowResult["action"] = "updated";
      let productId = listing?.externalProductId ?? null;
      let variantId = listing?.externalVariantId ?? null;
      let inventoryItemId = listing?.externalInventoryItemId ?? null;
      const shouldCheckExisting = !dryRun || checkExistingOnDryRun;
      const found = !variantId && shouldCheckExisting ? await findVariantBySku(candidate.providerKey) : null;

      if (found) {
        productId = found.productId;
        variantId = found.variantId;
        inventoryItemId = found.inventoryItemId;
      }

      if (missingOnly && variantId) {
        rows.push({
          providerKey: candidate.providerKey,
          supplierVariantId: candidate.supplierVariantId,
          action: "skipped",
          reason: "already_exists_on_shopify",
          productId,
          variantId,
          inventoryItemId,
          stock: candidate.availableStock,
          price: candidate.targetPrice,
          pricingKind: candidate.pricingKind,
        });
        skipped += 1;
        if (!dryRun) {
          await upsertListingState({
            providerKey: candidate.providerKey,
            supplierVariantId: candidate.supplierVariantId,
            gtin: candidate.gtin,
            productId,
            variantId,
            inventoryItemId,
            stock: candidate.availableStock,
            price: candidate.targetPrice,
            status: candidate.availableStock <= 0 ? "SOLD_OUT" : "ACTIVE",
            soldOutAt: candidate.availableStock <= 0 ? new Date() : null,
            archivedAt: candidate.availableStock <= 0 ? new Date() : null,
            lastError: null,
            metadataJson: {
              title: candidate.title,
              pricingKind: candidate.pricingKind,
            },
          });
        }
        continue;
      }

      if (!variantId && candidate.gtin && shouldCheckExisting) {
        const byGtin = await findShopifyVariantsByGtin(candidate.gtin);
        const conflictMsg = describeGtinSkuConflict(candidate.providerKey, byGtin);
        if (conflictMsg) {
          errors += 1;
          rows.push({
            providerKey: candidate.providerKey,
            supplierVariantId: candidate.supplierVariantId,
            action: "error",
            reason: conflictMsg,
            price: candidate.targetPrice,
            stock: candidate.availableStock,
            pricingKind: candidate.pricingKind,
          });
          if (!dryRun) {
            await upsertListingState({
              providerKey: candidate.providerKey,
              supplierVariantId: candidate.supplierVariantId,
              gtin: candidate.gtin,
              stock: candidate.availableStock,
              price: candidate.targetPrice,
              status: "ERROR",
              lastError: conflictMsg,
              metadataJson: {
                title: candidate.title,
                pricingKind: candidate.pricingKind,
                shopifyGtinMatches: byGtin.map((v) => ({ sku: v.sku, variantId: v.variantId })),
              },
            });
          }
          continue;
        }
      }

      let didCreate = false;
      if (!variantId) {
        action = "created";
        if (!dryRun) {
          const createdRow = await createProductWithVariant({
            title: candidate.title,
            brand: candidate.brand,
            providerKey: candidate.providerKey,
            gtin: candidate.gtin,
            price: candidate.targetPrice,
          });
          productId = createdRow.productId;
          variantId = createdRow.variantId;
          inventoryItemId = createdRow.inventoryItemId;
          didCreate = true;
        }
      }

      const pushVariantFields = !missingOnly || didCreate;
      if (!dryRun && variantId && pushVariantFields && !productId) {
        throw new Error(
          "Missing Shopify productId for variant update; re-link listing or fix ChannelListingState.externalProductId."
        );
      }
      if (!dryRun && variantId && productId && pushVariantFields) {
        const updatedVariant = await updateVariantPricingAndIdentity({
          productId,
          variantId,
          sku: candidate.providerKey,
          barcode: candidate.gtin,
          price: candidate.targetPrice,
        });
        productId = updatedVariant.productId ?? productId;
        inventoryItemId = updatedVariant.inventoryItemId ?? inventoryItemId;
      }

      if (!dryRun && locationId && inventoryItemId && pushVariantFields) {
        await setInventoryQuantity({
          inventoryItemId,
          locationId,
          quantity: candidate.availableStock,
        });
      }

      const isSoldOut = candidate.availableStock <= 0;
      if (!dryRun && !missingOnly && isSoldOut && productId) {
        await archiveProduct(productId);
      }

      const status = isSoldOut ? "SOLD_OUT" : "ACTIVE";
      if (!dryRun) {
        await upsertListingState({
          providerKey: candidate.providerKey,
          supplierVariantId: candidate.supplierVariantId,
          gtin: candidate.gtin,
          productId,
          variantId,
          inventoryItemId,
          locationId,
          stock: candidate.availableStock,
          price: candidate.targetPrice,
          status,
          soldOutAt: isSoldOut ? new Date() : null,
          archivedAt: isSoldOut ? new Date() : null,
          lastError: null,
          metadataJson: {
            title: candidate.title,
            pricingKind: candidate.pricingKind,
          },
        });
      }

      if (action === "created") created += 1;
      if (action === "updated") updated += 1;
      if (isSoldOut) {
        soldOut += 1;
        action = "sold_out";
      }

      rows.push({
        providerKey: candidate.providerKey,
        supplierVariantId: candidate.supplierVariantId,
        action,
        productId,
        variantId,
        inventoryItemId,
        stock: candidate.availableStock,
        price: candidate.targetPrice,
        pricingKind: candidate.pricingKind,
      });
    } catch (error: any) {
      errors += 1;
      const message = error?.message ?? "Unknown Shopify catalog sync error";
      rows.push({
        providerKey: candidate.providerKey,
        supplierVariantId: candidate.supplierVariantId,
        action: "error",
        reason: message,
        price: candidate.targetPrice,
        stock: candidate.availableStock,
        pricingKind: candidate.pricingKind,
      });
      if (!dryRun) {
        await upsertListingState({
          providerKey: candidate.providerKey,
          supplierVariantId: candidate.supplierVariantId,
          gtin: candidate.gtin,
          stock: candidate.availableStock,
          price: candidate.targetPrice,
          status: "ERROR",
          lastError: message,
          metadataJson: {
            title: candidate.title,
            pricingKind: candidate.pricingKind,
          },
        });
      }
    }
  }

  skipped = rows.filter((row) => row.action === "skipped").length;

  return {
    dryRun,
    scanned: candidates.length,
    created,
    updated,
    soldOut,
    skipped,
    errors,
    rows,
  };
}
