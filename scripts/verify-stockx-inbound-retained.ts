#!/usr/bin/env npx tsx
/**
 * Read-only: list the retained StockX inbound packages (top 100 per account)
 * with AWB / stockxEventAt / firstSeenAt / lastSeenAt / retention date source.
 *
 * Usage:
 *   npx tsx scripts/verify-stockx-inbound-retained.ts
 *   npx tsx scripts/verify-stockx-inbound-retained.ts --account default --limit 100
 *
 * Optional: if tmp/inbound-sync-last-sources.json exists (written by
 * run-stockx-inbound-sync.ts), join per-AWB logisticsDateSource.
 */

import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/app/lib/prisma";
import {
  STOCKX_INBOUND_PACKAGE_RETENTION,
  inboundRetentionRankAt,
} from "@/app/lib/stockxInboundPackages";

type SourceMap = Record<string, string>;

function loadSourceMap(): SourceMap {
  const p = path.join(process.cwd(), "tmp", "inbound-sync-last-sources.json");
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return (raw?.byAwb ?? raw ?? {}) as SourceMap;
  } catch {
    return {};
  }
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  return process.argv[i + 1] ?? null;
}

async function main() {
  const limit = Math.max(
    1,
    Math.min(500, Number(argValue("--limit") ?? STOCKX_INBOUND_PACKAGE_RETENTION))
  );
  const accountFilter = argValue("--account");
  const prismaAny = prisma as any;
  if (!prismaAny.stockxInboundPackage) {
    console.error("StockxInboundPackage model missing — apply migrations first.");
    process.exit(2);
  }

  const where = accountFilter ? { stockxAccountKey: accountFilter } : {};
  const rows = await prismaAny.stockxInboundPackage.findMany({
    where,
    select: {
      awb: true,
      stockxAccountKey: true,
      stockxEventAt: true,
      firstSeenAt: true,
      lastSeenAt: true,
      purchaseDate: true,
      status: true,
      sku: true,
      sizeEU: true,
      productName: true,
      arrivedAt: true,
    },
  });

  const sources = loadSourceMap();
  const ranked = [...rows].sort(
    (a, b) =>
      inboundRetentionRankAt(b).getTime() - inboundRetentionRankAt(a).getTime()
  );

  // Group by account, keep top N
  const byAccount = new Map<string, typeof ranked>();
  for (const row of ranked) {
    const key = String(row.stockxAccountKey ?? "default");
    const list = byAccount.get(key) ?? [];
    if (list.length < limit) list.push(row);
    byAccount.set(key, list);
  }

  let poisonPurchase = 0;
  let withEvent = 0;
  let fallback = 0;

  console.log(
    JSON.stringify(
      {
        ok: true,
        limitPerAccount: limit,
        accounts: byAccount.size,
        sourceMapLoaded: Object.keys(sources).length > 0,
      },
      null,
      2
    )
  );

  for (const [accountKey, list] of byAccount) {
    console.log(`\n=== account=${accountKey} kept=${list.length} ===`);
    console.log(
      [
        "awb",
        "stockxEventAt",
        "firstSeenAt",
        "lastSeenAt",
        "retentionSource",
        "logisticsDateSource",
        "purchaseDate",
        "status",
        "sku",
        "sizeEU",
      ].join("\t")
    );
    for (const row of list) {
      const event = row.stockxEventAt ? new Date(row.stockxEventAt) : null;
      const purchase = row.purchaseDate ? new Date(row.purchaseDate) : null;
      const retentionSource = event ? "stockxEventAt" : "first_seen";
      const logisticsDateSource =
        sources[String(row.awb).toUpperCase()] ??
        (event ? "observed_unknown" : "first_seen");
      if (event) withEvent += 1;
      else fallback += 1;
      if (
        event &&
        purchase &&
        Math.abs(event.getTime() - purchase.getTime()) < 1000
      ) {
        poisonPurchase += 1;
      }
      console.log(
        [
          row.awb,
          event?.toISOString() ?? "",
          row.firstSeenAt ? new Date(row.firstSeenAt).toISOString() : "",
          row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : "",
          retentionSource,
          logisticsDateSource,
          purchase?.toISOString() ?? "",
          row.status ?? "",
          row.sku ?? "",
          row.sizeEU ?? "",
        ].join("\t")
      );
    }
  }

  console.log(
    "\n" +
      JSON.stringify(
        {
          summary: {
            listed: withEvent + fallback,
            withLogisticsEventAt: withEvent,
            fallbackFirstSeenAt: fallback,
            poisonPurchaseEqualsEvent: poisonPurchase,
          },
        },
        null,
        2
      )
  );

  if (poisonPurchase > 0) {
    console.error(
      `FAIL: ${poisonPurchase} row(s) have stockxEventAt ≈ purchaseDate (forbidden).`
    );
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });
