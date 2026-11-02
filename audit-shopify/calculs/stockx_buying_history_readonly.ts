/**
 * Extraction LECTURE SEULE de l'historique d'achats StockX (compte « Shopify »).
 * Aucun achat, aucune écriture StockX ni DB. Sortie : donnees_brutes/stockx_buying_history.json (champs utiles, sans adresse).
 * Usage : npx tsx audit-shopify/calculs/stockx_buying_history_readonly.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fetchRecentStockxBuyingOrders } from "@/galaxus/stx/stockxClient";
import { resolveStockxBearerToken } from "@/lib/stockxToken";

async function main() {
  const tok: any = await resolveStockxBearerToken();
  const token = typeof tok === "string" ? tok : tok?.token ?? tok?.bearer ?? null;
  if (!token) throw new Error("no stockx token");
  const out: any[] = [];
  const seen = new Set<string>();
  for (const state of ["PENDING", "HISTORICAL"]) {
    const nodes = await fetchRecentStockxBuyingOrders(token, { first: 100, maxPages: 120, state });
    console.log(state, nodes.length);
    for (const n of nodes as any[]) {
      const key = `${n.chainId}::${n.orderId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = n.productVariant?.product ?? {};
      out.push({
        orderId: n.orderId, orderNumber: n.orderNumber, chainId: n.chainId, purchaseDate: n.purchaseDate, creationDate: n.creationDate,
        amount: n.amount, currency: n.currencyCode, status: n.state?.statusKey, statusTitle: n.state?.statusTitle,
        size: n.localizedSizeTitle ?? n.productVariant?.traits?.size ?? null, variantId: n.productVariant?.id ?? null,
        title: p.title ?? p.name ?? null, styleId: p.styleId ?? p.model ?? null, eta: n.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null,
        listingType: n.listingType ?? null,
      });
    }
  }
  const dir = path.resolve(__dirname, "../donnees_brutes");
  fs.writeFileSync(path.join(dir, "stockx_buying_history.json"), JSON.stringify(out));
  console.log("saved", out.length);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
