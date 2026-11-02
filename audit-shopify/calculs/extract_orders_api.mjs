#!/usr/bin/env node
// Extraction LECTURE SEULE de toutes les commandes Shopify (API Admin) -> NDJSON (sans nom/email/adresse).
// Usage : node extract_orders_api.mjs <sortie.ndjson> [created_at_min=2022-01-01]
import fs from "node:fs";
import { shopifyRead } from "./shopify_readonly.mjs";

const out = process.argv[2] || "audit-shopify/donnees_brutes/orders_api.ndjson";
const since = process.argv[3] || "2022-01-01";
const M = "shopMoney { amount currencyCode }";
const Q = `query($first:Int!,$after:String,$q:String!){
 orders(first:$first, after:$after, query:$q, sortKey:CREATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{
   id name createdAt processedAt cancelledAt cancelReason closedAt test tags sourceName
   displayFinancialStatus displayFulfillmentStatus taxesIncluded paymentGatewayNames currencyCode presentmentCurrencyCode
   totalPriceSet{${M}} currentTotalPriceSet{${M}} subtotalPriceSet{${M}} currentSubtotalPriceSet{${M}}
   totalDiscountsSet{${M}} totalShippingPriceSet{${M}} totalTaxSet{${M}} currentTotalTaxSet{${M}}
   totalRefundedSet{${M}} totalRefundedShippingSet{${M}}
   shippingAddress{countryCodeV2} billingAddress{countryCodeV2}
   customer{id numberOfOrders createdAt}
   customerJourneySummary{ daysToConversion customerOrderIndex
     firstVisit{ source sourceType referrerUrl landingPage utmParameters{source medium campaign} }
     lastVisit{ source sourceType referrerUrl landingPage utmParameters{source medium campaign} } }
   discountCodes
   shippingLines(first:3){nodes{title code originalPriceSet{${M}} discountedPriceSet{${M}}}}
   lineItems(first:40){nodes{ id title variantTitle sku quantity vendor
     product{id productType} variant{id}
     originalTotalSet{${M}} discountedTotalSet{${M}} taxLines{rate priceSet{${M}}} }}
   transactions(first:15){ id kind status gateway processedAt amountSet{${M}}
     fees{ type rate amount{amount currencyCode} flatFee{amount} } }
   refunds(first:10){ id createdAt note totalRefundedSet{${M}}
     refundLineItems(first:20){nodes{quantity restockType subtotalSet{${M}} lineItem{id}}} }
   returns(first:5){nodes{id status createdAt}}
  }}}`;

fs.mkdirSync(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
const ws = fs.createWriteStream(out);
let after = null, n = 0, pages = 0, size = 40;
for (;;) {
  const j = await shopifyRead(Q, { first: size, after, q: `created_at:>=${since}` });
  if (j.errors) {
    const msg = JSON.stringify(j.errors).slice(0, 400);
    if (/THROTTLED|Throttled/.test(msg)) { await new Promise(r => setTimeout(r, 3000)); continue; }
    if (/cost|exceeds/i.test(msg) && size > 10) { size = Math.floor(size / 2); continue; }
    console.error("ERREUR", msg); process.exit(1);
  }
  const d = j.data.orders;
  for (const o of d.nodes) { ws.write(JSON.stringify(o) + "\n"); n++; }
  pages++;
  if (pages % 10 === 0) console.error(`pages=${pages} orders=${n}`);
  const avail = j.extensions?.cost?.throttleStatus?.currentlyAvailable;
  if (avail != null && avail < 400) await new Promise(r => setTimeout(r, 1500));
  if (!d.pageInfo.hasNextPage) break;
  after = d.pageInfo.endCursor;
}
ws.end();
console.log(`OK ${n} commandes -> ${out} (${new Date().toISOString()})`);
