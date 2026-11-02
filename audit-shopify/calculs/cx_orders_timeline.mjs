// Extraction LECTURE SEULE : timeline Shopify (events), notes, retours, fulfillments des commandes 2026. Sanitisation PII (emails, noms dans messages, 4 derniers chiffres carte).
import fs from "node:fs"; import { shopifyRead } from "./shopify_readonly.mjs";
const out = "audit-shopify/donnees_brutes/cx_orders_timeline_2026.ndjson";
const Q = `query($first:Int!,$after:String,$q:String!){ orders(first:$first, after:$after, query:$q, sortKey:CREATED_AT){ pageInfo{hasNextPage endCursor} nodes{
 name createdAt cancelledAt cancelReason displayFinancialStatus displayFulfillmentStatus note tags sourceName
 customer{ id numberOfOrders }
 shippingAddress{ countryCodeV2 }
 fulfillments(first:5){ createdAt status displayStatus deliveredAt inTransitAt estimatedDeliveryAt }
 returns(first:5){ nodes{ id status createdAt returnLineItems(first:5){ nodes{ ... on ReturnLineItem{ returnReason returnReasonNote quantity } } } } }
 refunds(first:5){ createdAt note totalRefundedSet{shopMoney{amount}} }
 events(first:40){ nodes{ __typename ... on BasicEvent{ message createdAt } ... on CommentEvent{ message createdAt } } }
}}}`;
const san = s => (s || "").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").replace(/ending in \d+/g, "ending in ####")
  .replace(/^.* placed this order on/, "[client] placed this order on").replace(/ to [^()]{2,60} \(\[email\]\)/g, " to [client]").replace(/ by [^.]{2,60}\.$/, " by [client].")
  .replace(/(\+?\d[\d ]{8,})/g, "[tel]");
const ws = fs.createWriteStream(out); let after = null, n = 0, size = 20;
for (;;) {
  const j = await shopifyRead(Q, { first: size, after, q: "created_at:>=2026-01-01" });
  if (j.errors) { const m = JSON.stringify(j.errors).slice(0, 300); if (/Throttled|THROTTLED/.test(m)) { await new Promise(r => setTimeout(r, 4000)); continue; } if (/cost|exceed/i.test(m) && size > 4) { size = Math.floor(size / 2); continue; } console.error("ERR", m); process.exit(1); }
  const d = j.data.orders;
  for (const o of d.nodes) {
    o.note = san(o.note); o.events = o.events.nodes.map(e => ({ t: e.__typename, at: e.createdAt, m: san(e.message) }));
    o.refunds = o.refunds.map(r => ({ ...r, note: san(r.note) }));
    ws.write(JSON.stringify(o) + "\n"); n++;
  }
  const av = j.extensions?.cost?.throttleStatus?.currentlyAvailable; if (av != null && av < 300) await new Promise(r => setTimeout(r, 2500));
  if (n % 200 < size) console.error("n=", n);
  if (!d.pageInfo.hasNextPage) break; after = d.pageInfo.endCursor;
}
ws.end(); console.log("OK", n);
