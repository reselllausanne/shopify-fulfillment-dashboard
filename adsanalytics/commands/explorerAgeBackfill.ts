import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { computeExplorerEligibilityDebug, writeExplorerReport } from "@/adsanalytics/explorer/core";
import { log, withSyncRun } from "@/adsanalytics/run";

type Options = { days?: number };

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function explorerAgeBackfillCommand(options: Options = {}): Promise<number> {
  return withSyncRun("explorer:age-backfill", options, async () => {
    const days = Math.max(7, Math.floor(options.days ?? 30));
    const debug = await computeExplorerEligibilityDebug(days);
    const candidateIds = debug.finalCandidates.map((c) => c.shopifyProductId);

    // DB-first age source discovery. If no true Shopify Product table exists, report unknowns.
    const discoveredColumns = await prisma.$queryRaw<
      Array<{ table_name: string; column_name: string }>
    >(Prisma.sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name ILIKE 'Shopify%'
        AND (
          column_name ILIKE '%created%'
          OR column_name ILIKE '%product%'
        )
      ORDER BY table_name, column_name
    `);

    const proxyRows = await prisma.$queryRaw<
      Array<{ shopify_product_id: string; created_at: string }>
    >(Prisma.sql`
      SELECT "shopifyProductId" AS shopify_product_id, MIN("createdAt")::text AS created_at
      FROM "public"."ShopifySyncState"
      WHERE "shopifyProductId" IS NOT NULL
        AND "shopifyProductId" IN (${Prisma.join(candidateIds.length ? candidateIds : ["__none__"])})
      GROUP BY "shopifyProductId"
    `);
    const proxyMap = new Map(proxyRows.map((r) => [r.shopify_product_id, r.created_at]));

    let written = 0;
    for (const batch of chunk(candidateIds, 500)) {
      const values = batch.map((id) => {
        const createdAt = proxyMap.get(id) ?? null;
        const source = createdAt ? "proxy_shopify_sync_state" : "unknown";
        const unknownReason = createdAt ? null : "shopify_product_created_at_unavailable";
        return Prisma.sql`(
          ${randomUUID()},
          ${id}::bigint,
          ${createdAt}::timestamptz,
          ${source},
          ${unknownReason},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )`;
      });
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "public"."ads_explorer_product_age" (
          "id","shopify_product_id","shopify_product_created_at","source","unknown_reason","captured_at","created_at","updated_at"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("shopify_product_id") DO UPDATE SET
          "shopify_product_created_at" = EXCLUDED."shopify_product_created_at",
          "source" = EXCLUDED."source",
          "unknown_reason" = EXCLUDED."unknown_reason",
          "captured_at" = EXCLUDED."captured_at",
          "updated_at" = CURRENT_TIMESTAMP
      `);
      written += batch.length;
    }

    const known = candidateIds.filter((id) => proxyMap.has(id)).length;
    const unknown = candidateIds.length - known;
    const report = {
      generatedAt: new Date().toISOString(),
      candidates: candidateIds.length,
      writtenRows: written,
      knownAgeRows: known,
      unknownAgeRows: unknown,
      nonBlockingPilotRule: true,
      discovery: discoveredColumns,
      note:
        "True Shopify Product.createdAt not materialized in current DB schema. Proxy stored from ShopifySyncState when available, else unknown.",
    };
    const outPath = await writeExplorerReport("explorer-age-backfill.json", report);
    log("explorer_age_backfill.summary", {
      candidates: candidateIds.length,
      known,
      unknown,
      writtenRows: written,
      reportPath: outPath,
    });
    return { candidates: candidateIds.length, known, unknown, writtenRows: written, reportPath: outPath };
  });
}

