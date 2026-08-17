/**
 * Auto-création d'OrderMatch à la réception d'un webhook orders/paid Shopify.
 *
 * Source de vérité coût = `inventoryItem.unitCost` natif Shopify (par variant).
 * Fallback = 0 (physical fulfillment, coût déjà expensé antérieurement).
 *
 * Ordre de résolution du coût par ligne:
 *   1. Ligne déjà matchée (MANUAL / StockX réel / manualCostOverride) → skip
 *   2. Fulfillment location NON physical/money-kickz → skip (laisse StockX auto-match faire)
 *   3. `inventoryItem.unitCost` > 0 (Essentials 26.45, Bape 35.20, AP 40, MK 59.96…) → cost = unitCost
 *   4. Sinon (chaussures physical, retour, warehouse) → cost = 0 (already expensed)
 *
 * Format `shopifyLineItemId` = GID complet (`gid://shopify/LineItem/…`) pour matcher la
 * convention legacy (UI save-match, package protection). Évite les doublons numeric/GID.
 *
 * Idempotent: upsert sur shopifyLineItemId.
 */
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { toShopifyCreatedAtStorage } from "@/app/utils/shopifySellDate";
import { isPackageProtectionShopifyLine } from "@/app/utils/matching";
import { resolveInStockFixedPriceRule } from "@/shopify/inventory/inStockFixedPrice";
import {
  isMoneyKickzLocationName,
  isPhysicalFulfillmentLocationName,
} from "@/shopify/orders/physicalFulfillmentLocations";

export const PHYSICAL_FULFILLMENT_MATCH_TYPE = "physical_fulfillment";
export const PHYSICAL_FULFILLMENT_STATUS = "PHYSICAL_STOCK";
export const FIXED_PRICE_MATCH_TYPE = "fixed_price_cost";
export const FIXED_PRICE_STATUS = "FIXED_PRICE_COST";
export const MONEY_KICKZ_MATCH_TYPE = "money_kickz_cost";
export const MONEY_KICKZ_STATUS = "MONEY_KICKZ_COST";

/** Format canonique du lineItemId dans OrderMatch (matches legacy UI/protection rows). */
function toLineItemGid(idOrGid: string | null | undefined): string {
  const raw = String(idOrGid ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("gid://")) return raw;
  return `gid://shopify/LineItem/${raw.replace(/\D/g, "")}`;
}

type OrderDetailsQuery = {
  order: {
    id: string;
    name: string;
    createdAt: string;
    displayFinancialStatus: string | null;
    cancelledAt: string | null;
    customer: { email: string | null; firstName: string | null; lastName: string | null } | null;
    lineItems: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          sku: string | null;
          variantTitle: string | null;
          quantity: number;
          currentQuantity: number | null;
          originalUnitPriceSet: { shopMoney: { amount: string; currencyCode: string } };
          image: { url: string | null } | null;
          variant: {
            id: string | null;
            selectedOptions: Array<{ name: string; value: string }> | null;
            inventoryItem: { unitCost: { amount: string | null } | null } | null;
          } | null;
        };
      }>;
    };
    fulfillmentOrders: {
      edges: Array<{
        node: {
          status: string | null;
          assignedLocation: {
            name: string | null;
            location: { id: string | null; name: string | null } | null;
          } | null;
          lineItems: {
            edges: Array<{
              node: {
                lineItem: { id: string | null } | null;
                remainingQuantity: number | null;
                totalQuantity: number | null;
              };
            }>;
          };
        };
      }>;
    };
  } | null;
};

const ORDER_DETAILS_QUERY = /* GraphQL */ `
  query OrderAutoMatchDetails($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      displayFinancialStatus
      cancelledAt
      customer { email firstName lastName }
      lineItems(first: 100) {
        edges {
          node {
            id
            title
            sku
            variantTitle
            quantity
            currentQuantity
            originalUnitPriceSet { shopMoney { amount currencyCode } }
            image { url }
            variant {
              id
              selectedOptions { name value }
              inventoryItem { unitCost { amount } }
            }
          }
        }
      }
      fulfillmentOrders(first: 20) {
        edges {
          node {
            status
            assignedLocation { name location { id name } }
            lineItems(first: 100) {
              edges { node { lineItem { id } remainingQuantity totalQuantity } }
            }
          }
        }
      }
    }
  }
`;

export type AutoMatchResult = {
  orderName: string | null;
  fixedRule: number;
  moneyKickz: number;
  physicalZero: number;
  skippedProtected: number;
  skippedNoLocation: number;
  errors: string[];
};

async function isMatchProtected(lineItemGid: string): Promise<boolean> {
  const row = await prisma.orderMatch.findUnique({
    where: { shopifyLineItemId: lineItemGid },
    select: {
      matchType: true,
      manualCostOverride: true,
      stockxOrderNumber: true,
      supplierCost: true,
    },
  });
  if (!row) return false;
  const t = String(row.matchType ?? "").toUpperCase();
  // Ne pas toucher aux matches créés par la UI (MANUAL, MANUAL_COST, LOCAL_AUTO)
  if (["MANUAL", "MANUAL_COST", "LOCAL_AUTO"].includes(t)) return true;
  if (row.manualCostOverride != null) return true;
  // Vrai numéro de commande StockX (pas synthétique)
  const ref = String(row.stockxOrderNumber ?? "");
  if (ref && !/^(ESS-|LOCAL-|PHYS-|MK-|INV-|FIX-|SAVED-|pp:)/i.test(ref)) return true;
  return false;
}

/**
 * Auto-match cost-0 (physical) + inventoryItem.unitCost (Essentials/Bape/AP/MK/etc)
 * pour une commande Shopify donnée. Ne remplace pas les matches existants protégés.
 */
export async function upsertAutoOrderMatchesForPaidOrder(
  orderGid: string
): Promise<AutoMatchResult> {
  const result: AutoMatchResult = {
    orderName: null,
    fixedRule: 0,
    moneyKickz: 0,
    physicalZero: 0,
    skippedProtected: 0,
    skippedNoLocation: 0,
    errors: [],
  };
  if (!orderGid) return result;

  const { data, errors } = await shopifyGraphQL<OrderDetailsQuery>(ORDER_DETAILS_QUERY, {
    id: orderGid,
  });
  if (errors?.length) {
    result.errors.push(errors.map((e) => e.message).join("; "));
    return result;
  }
  const order = data?.order;
  if (!order || order.cancelledAt) return result;

  result.orderName = order.name;
  const shopifyOrderId = order.id.match(/\/(\d+)$/)?.[1] ?? order.id;
  const createdAt = toShopifyCreatedAtStorage(new Date(order.createdAt));

  // Line GID → fulfillment location
  const locByLine = new Map<string, { locationId: string; locationName: string }>();
  for (const foEdge of order.fulfillmentOrders?.edges ?? []) {
    const fo = foEdge.node;
    const name = String(fo.assignedLocation?.location?.name ?? fo.assignedLocation?.name ?? "").trim();
    const id = String(fo.assignedLocation?.location?.id ?? "").trim();
    if (!name) continue;
    for (const liE of fo.lineItems?.edges ?? []) {
      const lineGid = toLineItemGid(liE.node.lineItem?.id);
      if (!lineGid) continue;
      if (!locByLine.has(lineGid)) locByLine.set(lineGid, { locationId: id, locationName: name });
    }
  }

  for (const liE of order.lineItems?.edges ?? []) {
    const li = liE.node;
    const title = String(li.title ?? "");
    const sku = li.sku ? String(li.sku) : null;
    if (isPackageProtectionShopifyLine(title, sku)) continue;

    const qty = Number(li.currentQuantity ?? li.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const lineItemGid = toLineItemGid(li.id);
    if (!lineItemGid) continue;

    const loc = locByLine.get(lineItemGid);
    if (!loc?.locationName) {
      result.skippedNoLocation += 1;
      continue;
    }

    const physical = isPhysicalFulfillmentLocationName(loc.locationName);
    const moneyKickz = isMoneyKickzLocationName(loc.locationName);
    if (!physical && !moneyKickz) continue; // Laisse StockX auto-match faire son travail

    if (await isMatchProtected(lineItemGid)) {
      result.skippedProtected += 1;
      continue;
    }

    const unitPrice = Number(li.originalUnitPriceSet?.shopMoney?.amount ?? 0) || 0;
    const revenue = Number((unitPrice * qty).toFixed(2));
    const currency = String(li.originalUnitPriceSet?.shopMoney?.currencyCode || "CHF");
    const sizeOpt = (li.variant?.selectedOptions ?? []).find((o) => /size/i.test(o.name));
    const sizeEU = sizeOpt?.value || li.variantTitle || null;

    // Résolution du coût par priorité:
    //   1. Fixed-price rule (Essentials 26, Bape 35, AP 40) — source: code, sûr
    //   2. Money Kickz location → inventoryItem.unitCost Shopify natif
    //   3. Physical location sans règle → cost 0 (chaussure déjà expensée via StockX)
    const productId = li.variant?.id?.match(/Product\/(\d+)/)?.[1] ?? null;
    const fixedRule = resolveInStockFixedPriceRule({ sku, title, productId });

    let supplierCost: number;
    let matchType: string;
    let stockxStatus: string;
    let stockxOrderPrefix: string;
    let matchReasons: string[];
    let bucket: "fixed" | "mk" | "phys";

    if (fixedRule) {
      supplierCost = Number((fixedRule.costChf * qty).toFixed(2));
      matchType = FIXED_PRICE_MATCH_TYPE;
      stockxStatus = FIXED_PRICE_STATUS;
      stockxOrderPrefix = "FIX";
      matchReasons = [
        `fixed_price_rule:${fixedRule.label}`,
        `unit_cost:${fixedRule.costChf}`,
      ];
      bucket = "fixed";
    } else if (moneyKickz) {
      const unitCostRaw = Number(li.variant?.inventoryItem?.unitCost?.amount ?? 0);
      if (!Number.isFinite(unitCostRaw) || unitCostRaw <= 0) {
        result.errors.push(`line ${lineItemGid} money-kickz missing unitCost`);
        continue;
      }
      const unitCost = Number(unitCostRaw.toFixed(4));
      supplierCost = Number((unitCost * qty).toFixed(2));
      matchType = MONEY_KICKZ_MATCH_TYPE;
      stockxStatus = MONEY_KICKZ_STATUS;
      stockxOrderPrefix = "MK";
      matchReasons = [
        "money_kickz_unit_cost",
        `location:${loc.locationName}`,
        `unit_cost:${unitCost}`,
      ];
      bucket = "mk";
    } else {
      // Physical location sans rule (chaussures, retours…) → coût 0 (déjà expensé)
      supplierCost = 0;
      matchType = PHYSICAL_FULFILLMENT_MATCH_TYPE;
      stockxStatus = PHYSICAL_FULFILLMENT_STATUS;
      stockxOrderPrefix = "PHYS";
      matchReasons = ["physical_fulfillment_zero_cost", `location:${loc.locationName}`];
      bucket = "phys";
    }

    const marginAmount = Number((revenue - supplierCost).toFixed(2));
    const marginPercent = revenue > 0 ? Number(((marginAmount / revenue) * 100).toFixed(2)) : 0;
    const stockxOrderNumber = `${stockxOrderPrefix}-${lineItemGid.replace(/^.*\//, "")}`;

    try {
      await prisma.orderMatch.upsert({
        where: { shopifyLineItemId: lineItemGid },
        create: {
          shopifyOrderId,
          shopifyOrderName: order.name,
          shopifyLineItemId: lineItemGid,
          shopifyProductTitle: title,
          shopifySku: sku,
          shopifySizeEU: sizeEU,
          shopifyTotalPrice: revenue,
          shopifyCurrencyCode: currency,
          shopifyCreatedAt: createdAt,
          shopifyCustomerEmail: order.customer?.email ?? null,
          shopifyCustomerFirstName: order.customer?.firstName ?? null,
          shopifyCustomerLastName: order.customer?.lastName ?? null,
          shopifyLineItemImageUrl: li.image?.url ?? null,
          supplierSource: "OTHER",
          stockxOrderNumber,
          stockxProductName: title,
          stockxSizeEU: sizeEU,
          stockxSkuKey: sku,
          matchConfidence: "high",
          matchScore: 100,
          matchType,
          matchReasons: JSON.stringify(matchReasons),
          stockxStatus,
          supplierCost,
          marginAmount,
          marginPercent,
          shopifyMetafieldsSynced: false,
        },
        update: {
          shopifyOrderId,
          shopifyOrderName: order.name,
          shopifyCreatedAt: createdAt,
          supplierSource: "OTHER",
          supplierCost,
          marginAmount,
          marginPercent,
          matchType,
          matchReasons: JSON.stringify(matchReasons),
          stockxStatus,
          stockxOrderNumber,
          matchConfidence: "high",
          matchScore: 100,
        },
      });
      if (bucket === "fixed") result.fixedRule += 1;
      else if (bucket === "mk") result.moneyKickz += 1;
      else result.physicalZero += 1;
    } catch (err: any) {
      result.errors.push(`line ${lineItemGid}: ${err?.message ?? String(err)}`);
    }
  }

  return result;
}
