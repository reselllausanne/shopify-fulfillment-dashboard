import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import type { DateRange } from "@/adsanalytics/dates";
import { log } from "@/adsanalytics/run";

const NOTES_MARKER = "google-ads-api";
const CHANNEL = "google";
const UPSERT_CHUNK = 100;

export type SyncDailyAdSpendResult = {
  range: DateRange;
  daysUpserted: number;
  totalSpendChf: number;
};

function toYmd(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function microsToChf(costMicros: number): number {
  return Number((costMicros / 1e6).toFixed(2));
}

/**
 * Aggregate ads_campaign_daily cost into DailyAdSpend (dashboard / monthly finance source).
 * Overwrites same-date rows; marks notes as google-ads-api.
 */
export async function syncDailyAdSpend(range: DateRange): Promise<SyncDailyAdSpendResult> {
  const rows = await prisma.$queryRaw<Array<{ date: Date | string; cost: number }>>(Prisma.sql`
    SELECT
      "date",
      COALESCE(SUM("cost_micros"), 0)::float8 AS cost
    FROM "public"."ads_campaign_daily"
    WHERE "date" BETWEEN ${range.start}::date AND ${range.end}::date
    GROUP BY "date"
    ORDER BY "date" ASC
  `);

  let daysUpserted = 0;

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const batch = rows.slice(i, i + UPSERT_CHUNK);
    if (batch.length === 0) continue;

    const values = batch.map((row) => {
      const ymd = toYmd(row.date);
      const amountChf = microsToChf(row.cost);
      return Prisma.sql`(
        ${ymd}::date,
        ${amountChf}::numeric,
        ${CHANNEL},
        ${NOTES_MARKER},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )`;
    });

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "public"."DailyAdSpend" (
        "date", "amountChf", "channel", "notes", "createdAt", "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("date") DO UPDATE SET
        "amountChf" = EXCLUDED."amountChf",
        "channel" = EXCLUDED."channel",
        "notes" = EXCLUDED."notes",
        "updatedAt" = CURRENT_TIMESTAMP
    `);

    daysUpserted += batch.length;
  }

  const totalSpendChf = Number(
    rows.reduce((sum, row) => sum + microsToChf(row.cost), 0).toFixed(2)
  );

  const result = { range, daysUpserted, totalSpendChf };
  log("sync_daily_ad_spend.done", result as unknown as Record<string, unknown>);
  return result;
}
