import crypto from "node:crypto";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";
import { schedulePostSaleMarketplacePricePush } from "@/inventory/postSaleMarketplacePricePush";
import { resolveProviderKeyForGtin } from "@/shopify/restock/channelListingState";
import { processShopifyPaidPhysicalSale } from "@/shopify/localStock/processShopifyPaidPhysicalSale";
import { refreshAfterShopifySale } from "@/shopify/orders/postSaleRefresh";
import { markPaidLineProcessed } from "@/shopify/orders/paidLineState";

export type OrderPaidLineItem = {
  id?: number | string;
  variant_id?: number | string | null;
  sku?: string | null;
  barcode?: string | null;
  title?: string | null;
  variant_title?: string | null;
  quantity?: number | null;
  price?: string | number | null;
};

export type OrderPaidPayload = {
  id?: number | string;
  admin_graphql_api_id?: string;
  line_items?: OrderPaidLineItem[];
};

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Client secrets that may sign Shopify webhooks (custom app + legacy aliases). */
export function webhookSigningSecrets(): string[] {
  const keys = ["SHOPIFY_API_SECRET", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_WEBHOOK_SECRET"] as const;
  const out: string[] = [];
  for (const key of keys) {
    const value = String(process.env[key] ?? "").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

export function verifyShopifyWebhookHmac(rawBody: Buffer, hmacHeader: string | null): boolean {
  if (!hmacHeader || rawBody.length === 0) return false;
  for (const secret of webhookSigningSecrets()) {
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
    if (timingSafeEq(expected, hmacHeader)) return true;
  }
  return false;
}

export function toVariantGid(idish: number | string | null | undefined): string | null {
  if (idish == null) return null;
  const s = String(idish).trim();
  if (!s) return null;
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/ProductVariant/${s}`;
}

function normalizeGtin(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  for (const candidate of gtinCandidates(value)) {
    if (candidate) return candidate;
  }
  return value;
}

function normalizeSizeToken(raw: string | null | undefined): string | null {
  const input = String(raw ?? "").trim().toUpperCase();
  if (!input) return null;
  const cleaned = input
    .replace(/\s+/g, "")
    .replace(/^EU/, "")
    .replace(",", ".")
    .trim();
  if (!cleaned) return null;
  if (!/^\d{1,2}(?:\.\d+)?$/.test(cleaned)) return null;
  return cleaned.replace(/\.0+$/, "");
}

function parseSkuBaseAndSize(
  rawSku: string | null | undefined
): { baseSku: string; sizeToken: string } | null {
  const sku = String(rawSku ?? "").trim().toUpperCase();
  if (!sku) return null;
  // Common Shopify format: DQ3977-100-40 (style-color-sizeEU)
  const match = sku.match(/^(.+)-(\d{1,2}(?:[.,]\d+)?)$/);
  if (!match) return null;
  const baseSku = match[1]?.trim();
  const sizeToken = normalizeSizeToken(match[2]);
  if (!baseSku || !sizeToken) return null;
  return { baseSku, sizeToken };
}

async function resolveGtinFromPaidHistoryByVariant(
  variantGid: string | null
): Promise<string | null> {
  if (!variantGid) return null;
  const row = await (prisma as any).shopifyPaidLineState.findFirst({
    where: {
      variantId: variantGid,
      ok: true,
      gtin: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { gtin: true },
  });
  return normalizeGtin(row?.gtin ?? null);
}

async function resolveGtinFromSkuAndSize(
  sku: string | null | undefined
): Promise<string | null> {
  const parsed = parseSkuBaseAndSize(sku);
  if (!parsed) return null;
  const { baseSku, sizeToken } = parsed;
  const sizeCandidates = Array.from(
    new Set([`EU ${sizeToken}`, `EU${sizeToken}`, sizeToken])
  );
  const rows = await prisma.supplierVariant.findMany({
    where: {
      supplierSku: baseSku,
      gtin: { not: null },
      OR: sizeCandidates.map((sizeRaw) => ({ sizeRaw })),
    },
    select: {
      gtin: true,
      sizeRaw: true,
      stock: true,
      updatedAt: true,
    },
    orderBy: [{ stock: "desc" }, { updatedAt: "desc" }],
    take: 10,
  });
  if (rows.length === 0) return null;

  const exact = rows.filter((r) => normalizeSizeToken(r.sizeRaw) === sizeToken);
  const candidates = exact.length > 0 ? exact : rows;
  const uniqueGtins = Array.from(
    new Set(candidates.map((r) => normalizeGtin(r.gtin)).filter(Boolean))
  );
  if (uniqueGtins.length === 1) return uniqueGtins[0]!;
  return null;
}

const VARIANT_BARCODES_QUERY = /* GraphQL */ `
query OrdersPaidVariantBarcodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      sku
      barcode
    }
  }
}
`;

async function fetchGtinsFromShopifyVariants(variantGids: string[]): Promise<string[]> {
  if (variantGids.length === 0) return [];
  const { data, errors } = await shopifyGraphQL<{
    nodes: Array<{ id?: string; sku?: string | null; barcode?: string | null } | null>;
  }>(VARIANT_BARCODES_QUERY, { ids: variantGids });
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }

  const out = new Set<string>();
  for (const node of data?.nodes ?? []) {
    const gtin = normalizeGtin(node?.barcode ?? null);
    if (gtin) out.add(gtin);
  }
  return Array.from(out);
}

/** Resolve GTINs for order line items — one GTIN per sold variant (barcode-first). */
export async function resolveGtinsForLineItems(items: OrderPaidLineItem[]): Promise<string[]> {
  const out = new Set<string>();

  for (const item of items) {
    const gid = toVariantGid(item.variant_id ?? null);
    const sku = String(item.sku ?? "").trim();
    const lineBarcode = normalizeGtin(item.barcode ?? null);
    if (lineBarcode) {
      out.add(lineBarcode);
      continue;
    }

    if (gid) {
      const fromVariant = await fetchGtinsFromShopifyVariants([gid]);
      if (fromVariant.length >= 1) {
        out.add(fromVariant[0]!);
        continue;
      }
    }

    if (gid) {
      const fromPaidHistory = await resolveGtinFromPaidHistoryByVariant(gid);
      if (fromPaidHistory) {
        out.add(fromPaidHistory);
        continue;
      }
    }

    if (gid) {
      const rows = await prisma.$queryRaw<Array<{ gtin: string | null }>>`
        SELECT DISTINCT "gtin"
        FROM "public"."ShopifyVariantLocationStock"
        WHERE "shopifyVariantId" = ${gid}
          AND "gtin" IS NOT NULL
        LIMIT 1
      `;
      const mirrorGtin = normalizeGtin(rows[0]?.gtin ?? null);
      if (mirrorGtin) {
        out.add(mirrorGtin);
        continue;
      }
    }

    if (sku && gid) {
      const rows = await prisma.$queryRaw<Array<{ gtin: string | null }>>`
        SELECT DISTINCT sv."gtin"
        FROM "public"."SupplierVariant" sv
        INNER JOIN "public"."ShopifyVariantLocationStock" s
          ON s."gtin" = sv."gtin"
        WHERE sv."supplierSku" = ${sku}
          AND s."shopifyVariantId" = ${gid}
          AND sv."gtin" IS NOT NULL
        LIMIT 1
      `;
      const scopedGtin = normalizeGtin(rows[0]?.gtin ?? null);
      if (scopedGtin) {
        out.add(scopedGtin);
        continue;
      }
    }

    if (sku) {
      const fromSkuAndSize = await resolveGtinFromSkuAndSize(sku);
      if (fromSkuAndSize) {
        out.add(fromSkuAndSize);
        continue;
      }
    }

    if (sku) {
      const rows = await prisma.$queryRaw<Array<{ gtin: string | null }>>`
        SELECT DISTINCT sv."gtin"
        FROM "public"."SupplierVariant" sv
        WHERE sv."supplierSku" = ${sku}
          AND sv."gtin" IS NOT NULL
        LIMIT 1
      `;
      const stxGtin = normalizeGtin(rows[0]?.gtin ?? null);
      if (stxGtin) out.add(stxGtin);
    }
  }

  return Array.from(out);
}

export type GtinSaleLine = {
  gtin: string;
  quantity: number;
  lineItemId: string | null;
  variantId: string | null;
  sku: string | null;
  revenue: number;
};

/** One GTIN + sold qty per line item (for post-sale inventory decrement). */
export async function resolveGtinSalesForLineItems(items: OrderPaidLineItem[]): Promise<GtinSaleLine[]> {
  const sales: GtinSaleLine[] = [];

  for (const item of items) {
    const qty = Math.max(1, Math.trunc(Number(item.quantity ?? 1)));
    const lineItemId = item.id != null ? String(item.id) : null;
    const variantId = toVariantGid(item.variant_id ?? null);
    const sku = String(item.sku ?? "").trim() || null;
    const unitPrice = Number(item.price ?? 0);
    const revenue = Number.isFinite(unitPrice) ? unitPrice * qty : 0;
    const gtins = await resolveGtinsForLineItems([item]);
    const gtin = gtins[0];
    if (!gtin) continue;
    sales.push({ gtin, quantity: qty, lineItemId, variantId, sku, revenue });
  }

  return sales;
}

export type OrdersPaidConvergenceResult = {
  orderId: string;
  gtins: string[];
  results: Array<{
    gtin: string;
    changed: boolean;
    changes: string[];
    error?: string;
    shopifyOk?: boolean;
    kickdbOk?: boolean;
  }>;
};

export async function processOrdersPaidPayload(
  payload: OrderPaidPayload
): Promise<OrdersPaidConvergenceResult> {
  const items = Array.isArray(payload.line_items) ? payload.line_items : [];
  const orderId = String(payload.admin_graphql_api_id ?? payload.id ?? "");
  const sales = await resolveGtinSalesForLineItems(items);
  const gtins = sales.map((s) => s.gtin);

  const results: OrdersPaidConvergenceResult["results"] = [];
  for (const sale of sales) {
    try {
      const physical = await processShopifyPaidPhysicalSale({
        gtin: sale.gtin,
        sku: sale.sku,
        variantId: sale.variantId,
        lineItemId: sale.lineItemId,
        orderId,
        quantity: sale.quantity,
        revenue: sale.revenue,
      });
      if (physical.warnings.length) {
        console.warn("[shopify][orders-paid][physical-sale]", {
          orderId,
          gtin: sale.gtin,
          warnings: physical.warnings,
        });
      }

      const refresh = physical.refreshAlreadyRan
        ? { gtin: sale.gtin, warnings: physical.warnings, convergence: undefined, shopifyRefresh: { ok: true } }
        : await refreshAfterShopifySale(sale.gtin, {
            soldQty: sale.quantity,
            orderId,
            lineItemId: sale.lineItemId,
            variantId: sale.variantId,
            forceMarketPrice: true,
            skipDropshipRelist: physical.isPhysicalStoreSale,
          });
      const conv = refresh.convergence;
      const failed = refresh.warnings.length > 0 && !conv?.changed;
      results.push({
        gtin: sale.gtin,
        changed: Boolean(conv?.changed || refresh.shopifyRefresh?.ok),
        changes: conv?.changes ?? [],
        error: refresh.warnings.length ? refresh.warnings.join("; ") : conv?.error,
        shopifyOk: refresh.shopifyRefresh?.ok,
        kickdbOk: refresh.kickdbSync?.ok,
      });
      // Marks the line so the recent-paid cron does not converge it a second time.
      await markPaidLineProcessed(
        {
          orderId,
          lineItemId: sale.lineItemId,
          gtin: sale.gtin,
          variantId: sale.variantId,
          quantity: sale.quantity,
        },
        { ok: !failed, error: failed ? refresh.warnings.join("; ") : null }
      );
    } catch (err: any) {
      results.push({
        gtin: sale.gtin,
        changed: false,
        changes: [],
        error: err?.message ?? String(err),
      });
      await markPaidLineProcessed(
        {
          orderId,
          lineItemId: sale.lineItemId,
          gtin: sale.gtin,
          variantId: sale.variantId,
          quantity: sale.quantity,
        },
        { ok: false, error: err?.message ?? String(err) }
      );
    }
  }

  if (gtins.length > 0) {
    const providerKeys = new Set<string>();
    for (const gtin of gtins) {
      const { providerKey, synthetic } = await resolveProviderKeyForGtin(gtin);
      if (!synthetic && providerKey) providerKeys.add(providerKey);
    }
    schedulePostSaleMarketplacePricePush(null, Array.from(providerKeys));
  }

  return { orderId, gtins, results };
}
