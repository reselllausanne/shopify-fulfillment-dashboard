#!/usr/bin/env npx tsx
/**
 * Backfill one-shot des OrderMatch physical + metafield cost.
 *
 * Utilise le même module que le webhook orders/paid → cohérence garantie.
 * À exécuter une fois pour rattraper l'historique; les nouvelles commandes
 * seront auto-matchées via le webhook + cron.
 *
 * Usage:
 *   npx tsx scripts/backfill-auto-match-paid-orders.ts --days=90
 *   npx tsx scripts/backfill-auto-match-paid-orders.ts --days=30 --limit=100
 */
import "dotenv/config";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { upsertAutoOrderMatchesForPaidOrder } from "@/shopify/orders/autoMatchOnPaidOrder";

const prisma = new PrismaClient();

function argFlag(name: string): string | undefined {
  const p = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : undefined;
}
function argInt(name: string, fb: number): number {
  const v = argFlag(name);
  if (!v) return fb;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fb;
}

const DAYS = argInt("days", 90);
const LIMIT = argInt("limit", 10_000);

function toGid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
}

async function main() {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - DAYS);

  const orders = await prisma.shopifyOrder.findMany({
    where: { createdAt: { gte: since }, cancelledAt: null },
    orderBy: { createdAt: "desc" },
    select: { shopifyOrderId: true, orderName: true, createdAt: true },
    take: LIMIT,
  });
  console.log(`[backfill-auto-match] scanning ${orders.length} orders (${DAYS}d)`);

  const totals = { fixedRule: 0, moneyKickz: 0, physicalZero: 0, skippedProtected: 0, skippedNoLocation: 0, errors: 0 };
  const errorSamples: Array<{ order: string; err: string }> = [];
  const changed: Array<{ order: string; fixedRule: number; moneyKickz: number; physicalZero: number }> = [];

  for (let i = 0; i < orders.length; i += 1) {
    const o = orders[i];
    try {
      const res = await upsertAutoOrderMatchesForPaidOrder(toGid(o.shopifyOrderId));
      totals.fixedRule += res.fixedRule;
      totals.moneyKickz += res.moneyKickz;
      totals.physicalZero += res.physicalZero;
      totals.skippedProtected += res.skippedProtected;
      totals.skippedNoLocation += res.skippedNoLocation;
      totals.errors += res.errors.length;
      const created = res.fixedRule + res.moneyKickz + res.physicalZero;
      if (created > 0) {
        changed.push({ order: o.orderName, fixedRule: res.fixedRule, moneyKickz: res.moneyKickz, physicalZero: res.physicalZero });
      }
      if (res.errors.length && errorSamples.length < 20) {
        errorSamples.push({ order: o.orderName, err: res.errors.slice(0, 3).join(" | ") });
      }
    } catch (err: any) {
      totals.errors += 1;
      if (errorSamples.length < 20) errorSamples.push({ order: o.orderName, err: err?.message ?? String(err) });
    }
    if ((i + 1) % 25 === 0) {
      console.log(`  [${i + 1}/${orders.length}] fix=${totals.fixedRule} mk=${totals.moneyKickz} phys=${totals.physicalZero} err=${totals.errors}`);
    }
    // Shopify rate limit safety
    await new Promise((r) => setTimeout(r, 120));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    days: DAYS,
    scanned: orders.length,
    ...totals,
    changedOrdersCount: changed.length,
    changedOrders: changed.slice(0, 100),
    errorSamples,
  };
  const outPath = `tmp/backfill-auto-match-${DAYS}d.json`;
  fs.mkdirSync("tmp", { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n[backfill-auto-match] wrote ${outPath}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-auto-match] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
