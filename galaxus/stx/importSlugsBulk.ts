import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { chunkArray } from "@/galaxus/jobs/bulkSql";
import { normalizeStxImportInput } from "@/galaxus/stx/importProduct";

export type StxImportSlugRow = { input: string; slug: string };

export function dedupeSlugRows(lines: string[]): StxImportSlugRow[] {
  const bySlug = new Map<string, string>();
  for (const line of lines) {
    const slug = normalizeStxImportInput(line);
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, line.trim());
  }
  return Array.from(bySlug.entries()).map(([slug, input]) => ({ slug, input }));
}

/**
 * Insert queue rows only when slug is missing.
 * ON CONFLICT DO NOTHING — existing PENDING / IMPORTED / ERROR rows are untouched.
 */
export async function bulkInsertStxImportSlugs(
  rows: StxImportSlugRow[],
  options: { batchSize?: number } = {}
): Promise<number> {
  if (rows.length === 0) return 0;
  const batchSize = Math.max(1, options.batchSize ?? 500);
  const now = new Date();
  let insertedNew = 0;

  for (const batch of chunkArray(rows, batchSize)) {
    const values = batch.map(
      (row) =>
        Prisma.sql`(
          ${Prisma.sql`gen_random_uuid()`},
          ${now},
          ${row.input},
          ${row.slug},
          CAST('PENDING'::text AS "public"."StxImportSlugStatus")
        )`
    );

    const result = await prisma.$queryRaw<Array<{ slug: string }>>(Prisma.sql`
      INSERT INTO "public"."StxImportSlug" ("id", "createdAt", "input", "slug", "status")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("slug") DO NOTHING
      RETURNING "slug"
    `);
    insertedNew += result.length;
  }

  return insertedNew;
}

export async function getStxImportSlugCounts() {
  const prismaAny = prisma as any;
  const [pending, imported, error, total] = await Promise.all([
    prismaAny.stxImportSlug.count({ where: { status: "PENDING" } }),
    prismaAny.stxImportSlug.count({ where: { status: "IMPORTED" } }),
    prismaAny.stxImportSlug.count({ where: { status: "ERROR" } }),
    prismaAny.stxImportSlug.count(),
  ]);
  return { pending, imported, error, total };
}
