/**
 * Proof / audit: every Galaxus pair not yet linked to a StockX buy, grouped by order day,
 * with its last buyer verdict. Plus Shopify lines without a StockX link since --since.
 *
 *   npx tsx scripts/stockx-buyer-audit.ts --since=2026-10-22 [--cutoff=2026-11-08]
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { buildNightQueue, loadState, pairKey, resolvePair } from "@/lib/stockxAutoCheckout/galaxusNightBuyer";

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const since = new Date(`${arg("since", "2026-10-22")}T00:00:00+02:00`);
  const cutoff = arg("cutoff", "2026-11-08");
  const state = await loadState();
  const queue = await buildNightQueue({ since, skipOrders: new Set() });
  type Row = { day: string; order: string; title: string; verdict: string; stx: string };
  const rows: Row[] = [];
  for (const p of queue) {
    const s = state[pairKey(p)];
    let stx = "?";
    try {
      const r = await resolvePair(p);
      stx = r.ok ? "stx" : r.status === "not_stockx" ? "NOT_STX" : `review:${r.reason}`;
    } catch (e: any) {
      stx = `err:${String(e?.message || e).slice(0, 30)}`;
    }
    rows.push({
      day: p.orderDate.toISOString().slice(0, 10),
      order: p.galaxusOrderId,
      title: p.productName.slice(0, 48),
      verdict: s ? `${s.status}:${s.reason}` : "NEVER_TRIED",
      stx,
    });
  }
  const group = (rs: Row[]) => {
    const m = new Map<string, number>();
    for (const r of rs) m.set(`${r.stx} | ${r.verdict}`, (m.get(`${r.stx} | ${r.verdict}`) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${String(n).padStart(4)}  ${k}`).join("\n");
  };
  const upTo = rows.filter((r) => r.day <= cutoff);
  const after = rows.filter((r) => r.day > cutoff);
  console.log(`GALAXUS unlinked pairs since ${arg("since", "2026-10-22")}: ${rows.length}`);
  console.log(`\n== order day <= ${cutoff}: ${upTo.length}\n${group(upTo)}`);
  console.log(`\n== order day > ${cutoff}: ${after.length}\n${group(after)}`);
  console.log(`\nSTX-eligible & not bought (detail):`);
  for (const r of rows.filter((x) => x.stx === "stx")) console.log(`  ${r.day} ${r.order} ${r.title} -> ${r.verdict}`);

  const shop: Array<{ name: string; created: Date; title: string }> = await prisma.$queryRawUnsafe(
    `select o."name", o."createdAt" as created, coalesce(li.title,'') as title
     from "ShopifyOrder" o left join lateral (select '' as title) li on true
     where o."createdAt" >= $1 limit 0`,
    since
  ).catch(() => []);
  void shop;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERR", e?.message || e);
  process.exit(1);
});
