/** Modal adult shoe size per customer email from Shopify order history. Writes /tmp/bfcm-sizes.json */
import { writeFileSync } from "node:fs";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

const Q = `query($cursor:String){orders(first:100,after:$cursor,query:"created_at:>=2025-01-01 -status:cancelled",sortKey:CREATED_AT){pageInfo{hasNextPage endCursor}nodes{createdAt email customer{email}lineItems(first:30){nodes{title variantTitle product{productType tags}}}}}}`;

type Row = { size: string; at: string; title: string; kids: boolean };
const SHOE = /^(?:EU\s*)?(3[4-9]|4[0-9])(?:[.,]5| 1\/3| 2\/3)?$/i;

(async () => {
  const byEmail = new Map<string, Row[]>();
  let cursor: string | null = null;
  let orders = 0;
  for (;;) {
    const r: any = await shopifyGraphQL(Q, { cursor });
    const o = r.data?.orders ?? r.orders;
    if (!o) { console.log(JSON.stringify(r).slice(0, 500)); throw new Error("no orders"); }
    for (const n of o.nodes) {
      orders++;
      const email = (n.email || n.customer?.email || "").toLowerCase();
      if (!email) continue;
      for (const li of n.lineItems.nodes) {
        const vt = (li.variantTitle || "").trim();
        const size = vt.split("/")[0].trim();
        if (!SHOE.test(size)) continue;
        const kids = /kids|\(gs\)|\(ps\)|\(td\)|enfant|\bgs\b|toddler|junior/i.test(`${li.title} ${(li.product?.tags || []).join(" ")}`);
        const arr = byEmail.get(email) ?? [];
        arr.push({ size: size.replace(/^EU\s*/i, ""), at: n.createdAt, title: li.title, kids });
        byEmail.set(email, arr);
      }
    }
    if (!o.pageInfo.hasNextPage) break;
    cursor = o.pageInfo.endCursor;
  }
  const out: Record<string, { size: string; n: number; kidsOnly: boolean }> = {};
  for (const [email, rows] of byEmail) {
    const adult = rows.filter((x) => !x.kids);
    const use = adult.length ? adult : rows;
    const c = new Map<string, number>();
    for (const x of use) c.set(x.size, (c.get(x.size) || 0) + 1);
    const best = [...c.entries()].sort((a, b) => b[1] - a[1] || (use.findLast((x) => x.size === b[0])!.at > use.findLast((x) => x.size === a[0])!.at ? 1 : -1))[0];
    out[email] = { size: best[0], n: use.length, kidsOnly: adult.length === 0 };
  }
  writeFileSync("/tmp/bfcm-sizes.json", JSON.stringify(out));
  console.log(JSON.stringify({ orders, customersWithShoeSize: Object.keys(out).length, kidsOnly: Object.values(out).filter((v) => v.kidsOnly).length }));
})();
