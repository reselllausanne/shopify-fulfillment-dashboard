import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

/** ERROR slugs that parsed express variants but failed the old asks≥2 eligibility gate. */
export const STX_ASKS_THRESHOLD_RETRY_WHERE = Prisma.sql`
  "status" = CAST('ERROR'::text AS "public"."StxImportSlugStatus")
  AND "lastError" ~ 'variants [1-9][0-9]*/[0-9]+ parsed · eligible 0'
  AND "lastError" ILIKE '%No eligible express variants%'
`;

export async function countStxImportSlugsForAsksThresholdRetry(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "public"."StxImportSlug"
    WHERE ${STX_ASKS_THRESHOLD_RETRY_WHERE}
  `);
  return Number(rows[0]?.count ?? 0);
}

export async function listStxImportSlugsForAsksThresholdRetry(limit = 50) {
  const take = Math.min(Math.max(Math.trunc(limit), 1), 5000);
  return prisma.$queryRaw<Array<{ slug: string; input: string; lastError: string | null }>>(Prisma.sql`
    SELECT slug, input, "lastError"
    FROM "public"."StxImportSlug"
    WHERE ${STX_ASKS_THRESHOLD_RETRY_WHERE}
    ORDER BY "createdAt" ASC
    LIMIT ${take}
  `);
}

/** Move targeted ERROR rows back to PENDING so the normal slug sync worker picks them up. */
export async function resetStxImportSlugsForAsksThresholdRetry(): Promise<number> {
  const result = await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."StxImportSlug"
    SET
      "status" = CAST('PENDING'::text AS "public"."StxImportSlugStatus"),
      "lastError" = NULL,
      "importedAt" = NULL,
      "syncLockedAt" = NULL,
      "syncLockedBy" = NULL
    WHERE ${STX_ASKS_THRESHOLD_RETRY_WHERE}
  `);
  return Number(result ?? 0);
}
