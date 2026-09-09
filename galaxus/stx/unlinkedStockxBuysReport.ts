import { prisma } from "@/app/lib/prisma";
import {
  extractStockxVariantId,
  fetchRecentStockxBuyingOrders,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";

export type UnlinkedStockxBuyRow = {
  orderId: string | null;
  orderNumber: string | null;
  chainId: string | null;
  purchaseDate: string | null;
  variantId: string | null;
  productTitle: string | null;
  size: string | null;
  amount: number | null;
  currency: string | null;
  listState: string | null;
};

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

function mergeBuyingLists(batches: StockxBuyingNode[][]): StockxBuyingNode[] {
  const seen = new Set<string>();
  const out: StockxBuyingNode[] = [];
  for (const batch of batches) {
    for (const node of batch) {
      const key = `${trim(node.chainId)}::${trim(node.orderId)}`;
      if (!key || key === "::" || seen.has(key)) continue;
      seen.add(key);
      out.push(node);
    }
  }
  return out;
}

/** StockX buys with no Galaxus warehouse / direct-delivery link (match row or linked unit). */
export async function listUnlinkedGalaxusStockxBuys(): Promise<{
  ok: boolean;
  error?: string;
  totalFetched: number;
  unlinked: UnlinkedStockxBuyRow[];
}> {
  const token = await readGalaxusStockxToken();
  if (!token) {
    return { ok: false, error: "Missing Galaxus StockX token", totalFetched: 0, unlinked: [] };
  }

  const prismaAny = prisma as any;
  const [matches, units] = await Promise.all([
    prismaAny.galaxusStockxMatch.findMany({
      select: { stockxOrderId: true, stockxOrderNumber: true },
    }),
    prismaAny.stxPurchaseUnit.findMany({
      where: { stockxOrderId: { not: null } },
      select: { stockxOrderId: true, stockxOrderNumber: true },
    }),
  ]);

  const claimed = new Set<string>();
  for (const row of [...matches, ...units]) {
    const id = trim(row.stockxOrderId);
    const num = trim(row.stockxOrderNumber);
    if (id) claimed.add(id);
    if (num) claimed.add(num);
  }

  const [pending, historical, allState] = await Promise.all([
    fetchRecentStockxBuyingOrders(token, { first: 100, maxPages: 20, state: "PENDING" }).catch(
      () => [] as StockxBuyingNode[]
    ),
    fetchRecentStockxBuyingOrders(token, { first: 100, maxPages: 12, state: "HISTORICAL" }).catch(
      () => [] as StockxBuyingNode[]
    ),
    fetchRecentStockxBuyingOrders(token, { first: 100, maxPages: 8, state: null }).catch(
      () => [] as StockxBuyingNode[]
    ),
  ]);
  const buys = mergeBuyingLists([pending, historical, allState]);

  const unlinked: UnlinkedStockxBuyRow[] = [];
  for (const node of buys) {
    const orderId = trim(node.orderId) || null;
    const orderNumber = trim(node.orderNumber) || null;
    if ((orderId && claimed.has(orderId)) || (orderNumber && claimed.has(orderNumber))) continue;

    const variantId = extractStockxVariantId(node, null);
    const product = node.productVariant?.product ?? {};
    const amount =
      node.amount != null && Number.isFinite(Number(node.amount)) ? Number(node.amount) : null;

    unlinked.push({
      orderId,
      orderNumber,
      chainId: trim(node.chainId) || null,
      purchaseDate: trim(node.purchaseDate ?? node.creationDate) || null,
      variantId,
      productTitle: trim(product.title ?? product.name) || null,
      size: trim(node.localizedSizeTitle ?? node.productVariant?.traits?.size) || null,
      amount,
      currency: trim(node.currencyCode) || null,
      listState: trim(node.state?.statusKey ?? node.state?.statusTitle) || null,
    });
  }

  unlinked.sort((a, b) => String(b.purchaseDate ?? "").localeCompare(String(a.purchaseDate ?? "")));

  return { ok: true, totalFetched: buys.length, unlinked };
}
