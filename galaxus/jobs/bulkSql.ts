import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

export function chunkArray<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

export async function remapRowsToExistingProviderKeyGtin<
  T extends { supplierVariantId: string; providerKey?: string | null; gtin?: string | null }
>(rows: T[]): Promise<{ rows: T[]; remapped: number }> {
  if (rows.length === 0) return { rows, remapped: 0 };

  // Important: providerKey+gtin is unique in DB. We must avoid inserting a batch
  // that contains duplicates for the same pair (even if both are "new"), or Postgres
  // will throw a 23505 unique constraint error.
  const firstSeenByPair = new Map<string, string>();

  const pairs = Array.from(
    new Map(
      rows
        .filter((r) => r.providerKey && r.gtin)
        .map((r) => [`${r.providerKey}__${r.gtin}`, { providerKey: r.providerKey as string, gtin: r.gtin as string }])
    ).values()
  );
  if (pairs.length === 0) return { rows, remapped: 0 };

  const existingByKey = new Map<string, string>();
  for (const batch of chunkArray(pairs, 500)) {
    const pairSql = batch.map((p) => Prisma.sql`(${p.providerKey}, ${p.gtin})`);
    const existing = await prisma.$queryRaw<
      Array<{ supplierVariantId: string; providerKey: string; gtin: string }>
    >(Prisma.sql`
      SELECT "supplierVariantId", "providerKey", "gtin"
      FROM "public"."SupplierVariant"
      WHERE ("providerKey","gtin") IN (${Prisma.join(pairSql)})
    `);
    for (const row of existing) {
      existingByKey.set(`${row.providerKey}__${row.gtin}`, row.supplierVariantId);
    }
  }

  let remapped = 0;
  const normalizedRows = rows.map((row) => {
    if (!row.providerKey || !row.gtin) return row;
    const pairKey = `${row.providerKey}__${row.gtin}`;

    // 1) If DB already has this pair, always remap to that canonical row.
    const existingId = existingByKey.get(pairKey);
    if (existingId && existingId !== row.supplierVariantId) {
      remapped += 1;
      return { ...row, supplierVariantId: existingId };
    }

    // 2) If this input batch contains multiple rows for the same pair,
    // remap all to the first seen supplierVariantId to avoid 23505.
    const first = firstSeenByPair.get(pairKey);
    if (!first) {
      firstSeenByPair.set(pairKey, row.supplierVariantId);
      return row;
    }
    if (first === row.supplierVariantId) return row;
    remapped += 1;
    return { ...row, supplierVariantId: first };
  });

  return { rows: normalizedRows, remapped };
}

function jsonb(value: unknown) {
  if (value === undefined) return Prisma.sql`NULL::jsonb`;
  if (value === null) return Prisma.sql`NULL::jsonb`;
  return Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

export async function bulkInsertSupplierVariants(
  rows: Array<{
    supplierVariantId: string;
    supplierSku: string;
    providerKey: string | null;
    sizeNormalized?: string | null;
    price: number;
    stock: number;
    sizeRaw: string | null;
    supplierBrand: string | null;
    supplierProductName: string | null;
    images: unknown;
    leadTimeDays: number | null;
    deliveryType?: string | null;
    gtin?: string | null;
  }>,
  now: Date
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => {
    const gtin = r.gtin ?? null;
    const sizeNormalized = r.sizeNormalized ?? null;
    return Prisma.sql`(
      ${Prisma.sql`gen_random_uuid()`},
      ${r.supplierVariantId},
      ${r.supplierSku},
      ${r.providerKey},
      ${gtin},
      ${r.price},
      ${r.stock},
      ${r.sizeRaw},
      ${sizeNormalized},
      ${r.supplierBrand},
      ${r.supplierProductName},
      ${jsonb(r.images)},
      ${r.leadTimeDays},
      ${r.deliveryType ?? null},
      ${now},
      ${now},
      ${now}
    )`;
  });

  const query = Prisma.sql`
    WITH ins AS (
      INSERT INTO "public"."SupplierVariant" (
        "id",
        "supplierVariantId",
        "supplierSku",
        "providerKey",
        "gtin",
        "price",
        "stock",
        "sizeRaw",
        "sizeNormalized",
        "supplierBrand",
        "supplierProductName",
        "images",
        "leadTimeDays",
        "deliveryType",
        "lastSyncAt",
        "createdAt",
        "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("supplierVariantId") DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*)::int AS "count" FROM ins;
  `;

  const result = await prisma.$queryRaw<Array<{ count: number }>>(query);
  return result?.[0]?.count ?? 0;
}

export async function bulkInsertSupplierVariantsByProviderKeyGtin(
  rows: Array<{
    supplierVariantId: string;
    supplierSku: string;
    providerKey: string;
    gtin: string;
    price: number;
    stock: number;
    sizeRaw: string | null;
    sizeNormalized?: string | null;
  }>,
  now: Date
): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map((r) => {
    const sizeNormalized = r.sizeNormalized ?? null;
    return Prisma.sql`(
      ${Prisma.sql`gen_random_uuid()`},
      ${r.supplierVariantId},
      ${r.supplierSku},
      ${r.providerKey},
      ${r.gtin},
      ${r.price},
      ${r.stock},
      ${r.sizeRaw},
      ${sizeNormalized},
      ${now},
      ${now},
      ${now}
    )`;
  });
  const query = Prisma.sql`
    WITH ins AS (
      INSERT INTO "public"."SupplierVariant" (
        "id",
        "supplierVariantId",
        "supplierSku",
        "providerKey",
        "gtin",
        "price",
        "stock",
        "sizeRaw",
        "sizeNormalized",
        "lastSyncAt",
        "createdAt",
        "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("providerKey","gtin") DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*)::int AS "count" FROM ins;
  `;
  const result = await prisma.$queryRaw<Array<{ count: number }>>(query);
  return result?.[0]?.count ?? 0;
}

/**
 * Partner CSV import: upsert catalog rows by supplierVariantId.
 * Preserves existing providerKey + gtin on conflict (only stock/price/size/sku/lastSyncAt refresh).
 */
export async function bulkUpsertSupplierVariantsPartnerImport(
  rows: Array<{
    supplierVariantId: string;
    supplierSku: string;
    providerKey: string | null;
    gtin: string | null;
    price: number;
    stock: number;
    sizeRaw: string | null;
    sizeNormalized: string | null;
  }>,
  now: Date
): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((r) =>
    Prisma.sql`(
      ${Prisma.sql`gen_random_uuid()`},
      ${r.supplierVariantId},
      ${r.supplierSku},
      ${r.providerKey},
      ${r.gtin},
      ${r.price},
      ${r.stock},
      ${r.sizeRaw},
      ${r.sizeNormalized},
      ${now},
      ${now},
      ${now}
    )`
  );
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "public"."SupplierVariant" (
        "id",
        "supplierVariantId",
        "supplierSku",
        "providerKey",
        "gtin",
        "price",
        "stock",
        "sizeRaw",
        "sizeNormalized",
        "lastSyncAt",
        "createdAt",
        "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("supplierVariantId") DO UPDATE SET
        "supplierSku" = EXCLUDED."supplierSku",
        "sizeRaw" = EXCLUDED."sizeRaw",
        "sizeNormalized" = EXCLUDED."sizeNormalized",
        "stock" = EXCLUDED."stock",
        "price" = EXCLUDED."price",
        "gtin" = COALESCE("SupplierVariant"."gtin", EXCLUDED."gtin"),
        "providerKey" = CASE
          WHEN EXCLUDED."gtin" IS NULL THEN "SupplierVariant"."providerKey"
          ELSE COALESCE("SupplierVariant"."providerKey", EXCLUDED."providerKey")
        END,
        "lastSyncAt" = EXCLUDED."lastSyncAt",
        "updatedAt" = EXCLUDED."updatedAt"
    `
  );
}

export async function bulkUpdateSupplierVariantsByProviderKeyGtin(
  rows: Array<{
    providerKey: string;
    gtin: string;
    supplierSku?: string;
    price?: number;
    stock?: number;
    sizeRaw?: string | null;
    sizeNormalized?: string | null;
  }>,
  now: Date
): Promise<number> {
  if (rows.length === 0) return 0;
  const numericOrNull = (value: number | null | undefined, type: "numeric" | "int") =>
    value === null || value === undefined
      ? Prisma.sql`NULL::${Prisma.raw(type)}`
      : Prisma.sql`${value}::${Prisma.raw(type)}`;
  const values = rows.map((r) => Prisma.sql`(
    ${r.providerKey},
    ${r.gtin},
    ${r.supplierSku ?? null},
    ${numericOrNull(r.price, "numeric")},
    ${numericOrNull(r.stock, "int")},
    ${r.sizeRaw ?? null},
    ${r.sizeNormalized ?? null}
  )`);
  const query = Prisma.sql`
    WITH vals (
      "providerKey",
      "gtin",
      "supplierSku",
      "price",
      "stock",
      "sizeRaw",
      "sizeNormalized"
    ) AS (
      VALUES ${Prisma.join(values)}
    ),
    upd AS (
      UPDATE "public"."SupplierVariant" AS t
      SET
        "supplierSku" = COALESCE(vals."supplierSku", t."supplierSku"),
        "price" = COALESCE(vals."price", t."price"),
        "stock" = COALESCE(vals."stock", t."stock"),
        "sizeRaw" = COALESCE(vals."sizeRaw", t."sizeRaw"),
        "sizeNormalized" = COALESCE(vals."sizeNormalized", t."sizeNormalized"),
        "lastSyncAt" = ${now}
      FROM vals
      WHERE t."providerKey" = vals."providerKey"
        AND t."gtin" = vals."gtin"
        AND (t."manualLock" IS DISTINCT FROM TRUE)
        AND (
          (vals."supplierSku" IS NOT NULL AND t."supplierSku" IS DISTINCT FROM vals."supplierSku") OR
          (vals."price" IS NOT NULL AND t."price" IS DISTINCT FROM vals."price") OR
          (vals."stock" IS NOT NULL AND t."stock" IS DISTINCT FROM vals."stock") OR
          (vals."sizeRaw" IS NOT NULL AND t."sizeRaw" IS DISTINCT FROM vals."sizeRaw") OR
          (vals."sizeNormalized" IS NOT NULL AND t."sizeNormalized" IS DISTINCT FROM vals."sizeNormalized")
        )
      RETURNING 1
    )
    SELECT COUNT(*)::int AS "count" FROM upd;
  `;
  const result = await prisma.$queryRaw<Array<{ count: number }>>(query);
  return result?.[0]?.count ?? 0;
}

export async function bulkUpdateSupplierVariants(
  rows: Array<{
    supplierVariantId: string;
    supplierSku?: string;
    providerKey?: string | null;
    sizeNormalized?: string | null;
    price?: number;
    stock?: number;
    sizeRaw?: string | null;
    supplierBrand?: string | null;
    supplierProductName?: string | null;
    images?: unknown;
    leadTimeDays?: number | null;
    deliveryType?: string | null;
    gtin?: string | null;
    supplierGender?: string | null;
    supplierColorway?: string | null;
  }>,
  now: Date,
  options?: { updateGtinWhenProvided?: boolean }
): Promise<number> {
  if (rows.length === 0) return 0;
  const updateGtin = options?.updateGtinWhenProvided !== false;
  const numericOrNull = (value: number | null | undefined, type: "numeric" | "int") =>
    value === null || value === undefined
      ? Prisma.sql`NULL::${Prisma.raw(type)}`
      : Prisma.sql`${value}::${Prisma.raw(type)}`;
  const values = rows.map((r) => {
    const gtin = updateGtin ? (r.gtin ?? null) : null;
    return Prisma.sql`(
      ${r.supplierVariantId},
      ${r.supplierSku ?? null},
      ${r.providerKey ?? null},
      ${gtin},
      ${numericOrNull(r.price, "numeric")},
      ${numericOrNull(r.stock, "int")},
      ${r.sizeRaw ?? null},
      ${r.sizeNormalized ?? null},
      ${r.supplierBrand ?? null},
      ${r.supplierProductName ?? null},
      ${r.images === undefined ? Prisma.sql`NULL::jsonb` : jsonb(r.images)},
      ${numericOrNull(r.leadTimeDays, "int")},
      ${r.deliveryType ?? null},
      ${r.supplierGender ?? null},
      ${r.supplierColorway ?? null}
    )`;
  });

  const query = Prisma.sql`
    WITH vals (
      "supplierVariantId",
      "supplierSku",
      "providerKey",
      "gtin",
      "price",
      "stock",
      "sizeRaw",
      "sizeNormalized",
      "supplierBrand",
      "supplierProductName",
      "images",
      "leadTimeDays",
      "deliveryType",
      "supplierGender",
      "supplierColorway"
    ) AS (
      VALUES ${Prisma.join(values)}
    ),
    upd AS (
      UPDATE "public"."SupplierVariant" AS t
      SET
        "supplierSku" = COALESCE(vals."supplierSku", t."supplierSku"),
        "providerKey" = CASE
          WHEN vals."providerKey" IS NOT NULL THEN vals."providerKey"
          WHEN vals."gtin" IS NULL AND t."gtin" IS NULL THEN NULL
          ELSE t."providerKey"
        END,
        "price" = COALESCE(vals."price", t."price"),
        "stock" = COALESCE(vals."stock", t."stock"),
        "sizeRaw" = COALESCE(vals."sizeRaw", t."sizeRaw"),
        "sizeNormalized" = COALESCE(vals."sizeNormalized", t."sizeNormalized"),
        "supplierBrand" = COALESCE(vals."supplierBrand", t."supplierBrand"),
        "supplierProductName" = COALESCE(vals."supplierProductName", t."supplierProductName"),
        "images" = CASE
          WHEN vals."images" IS NULL THEN t."images"
          ELSE vals."images"
        END,
        "leadTimeDays" = COALESCE(vals."leadTimeDays", t."leadTimeDays"),
        "deliveryType" = COALESCE(vals."deliveryType", t."deliveryType"),
        "supplierGender" = COALESCE(vals."supplierGender", t."supplierGender"),
        "supplierColorway" = COALESCE(vals."supplierColorway", t."supplierColorway"),
        "gtin" = CASE
          WHEN vals."gtin" IS NULL THEN t."gtin"
          WHEN t."gtin" IS DISTINCT FROM vals."gtin"
            AND NOT EXISTS (
              SELECT 1
              FROM "public"."SupplierVariant" AS s2
              WHERE s2."providerKey" = COALESCE(vals."providerKey", t."providerKey")
                AND s2."gtin" = vals."gtin"
                AND s2."supplierVariantId" <> t."supplierVariantId"
            )
          THEN vals."gtin"
          ELSE t."gtin"
        END,
        "lastSyncAt" = CASE
          WHEN (
            t."price" IS DISTINCT FROM COALESCE(vals."price", t."price") OR
            t."stock" IS DISTINCT FROM COALESCE(vals."stock", t."stock") OR
            t."sizeRaw" IS DISTINCT FROM COALESCE(vals."sizeRaw", t."sizeRaw") OR
            t."sizeNormalized" IS DISTINCT FROM COALESCE(vals."sizeNormalized", t."sizeNormalized") OR
            t."supplierBrand" IS DISTINCT FROM COALESCE(vals."supplierBrand", t."supplierBrand") OR
            t."supplierProductName" IS DISTINCT FROM COALESCE(vals."supplierProductName", t."supplierProductName") OR
            (vals."images" IS NOT NULL AND t."images" IS DISTINCT FROM vals."images") OR
            t."leadTimeDays" IS DISTINCT FROM COALESCE(vals."leadTimeDays", t."leadTimeDays") OR
            t."deliveryType" IS DISTINCT FROM COALESCE(vals."deliveryType", t."deliveryType") OR
            t."supplierGender" IS DISTINCT FROM COALESCE(vals."supplierGender", t."supplierGender") OR
            t."supplierColorway" IS DISTINCT FROM COALESCE(vals."supplierColorway", t."supplierColorway") OR
            (vals."gtin" IS NOT NULL AND t."gtin" IS DISTINCT FROM vals."gtin") OR
            (vals."gtin" IS NULL AND t."gtin" IS NULL AND t."providerKey" IS NOT NULL AND vals."providerKey" IS NULL)
          )
          THEN ${now}
          ELSE t."lastSyncAt"
        END,
        "updatedAt" = ${now}
      FROM vals
      WHERE t."supplierVariantId" = vals."supplierVariantId"
        AND (t."manualLock" IS DISTINCT FROM TRUE)
        AND (
          t."price" IS DISTINCT FROM COALESCE(vals."price", t."price") OR
          t."stock" IS DISTINCT FROM COALESCE(vals."stock", t."stock") OR
          t."sizeRaw" IS DISTINCT FROM COALESCE(vals."sizeRaw", t."sizeRaw") OR
          t."sizeNormalized" IS DISTINCT FROM COALESCE(vals."sizeNormalized", t."sizeNormalized") OR
          t."supplierBrand" IS DISTINCT FROM COALESCE(vals."supplierBrand", t."supplierBrand") OR
          t."supplierProductName" IS DISTINCT FROM COALESCE(vals."supplierProductName", t."supplierProductName") OR
          (vals."images" IS NOT NULL AND t."images" IS DISTINCT FROM vals."images") OR
          t."leadTimeDays" IS DISTINCT FROM COALESCE(vals."leadTimeDays", t."leadTimeDays") OR
          t."deliveryType" IS DISTINCT FROM COALESCE(vals."deliveryType", t."deliveryType") OR
          t."supplierGender" IS DISTINCT FROM COALESCE(vals."supplierGender", t."supplierGender") OR
          t."supplierColorway" IS DISTINCT FROM COALESCE(vals."supplierColorway", t."supplierColorway") OR
          (vals."gtin" IS NOT NULL AND t."gtin" IS DISTINCT FROM vals."gtin") OR
          (vals."providerKey" IS NOT NULL AND t."providerKey" IS DISTINCT FROM vals."providerKey") OR
          (vals."gtin" IS NULL AND t."gtin" IS NULL AND t."providerKey" IS NOT NULL AND vals."providerKey" IS NULL) OR
          (vals."supplierSku" IS NOT NULL AND t."supplierSku" IS DISTINCT FROM vals."supplierSku")
        )
      RETURNING 1
    )
    SELECT COUNT(*)::int AS "count" FROM upd;
  `;

  const result = await prisma.$queryRaw<Array<{ count: number }>>(query);
  return result?.[0]?.count ?? 0;
}

export async function bulkUpsertVariantMappings(
  rows: Array<{
    supplierVariantId: string;
    gtin: string | null;
    providerKey: string | null;
    status: string;
    kickdbVariantId?: string | null;
  }>,
  now: Date,
  options?: { doNotDowngradeFromMatched?: boolean; onlySetPendingIfMissing?: boolean }
): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  // Postgres rejects duplicate keys in a single INSERT … VALUES even with ON CONFLICT;
  // dedupe so the same supplierVariantId appears at most once (last row wins).
  const byVariant = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    byVariant.set(r.supplierVariantId, r);
  }
  const rowsDeduped = Array.from(byVariant.values());

  const doNotDowngrade = options?.doNotDowngradeFromMatched !== false;
  const onlySetPendingIfMissing = options?.onlySetPendingIfMissing === true;

  // Insert missing mappings.
  const insertValues = rowsDeduped.map(
    (r) =>
      Prisma.sql`(
        ${Prisma.sql`gen_random_uuid()`},
        ${r.supplierVariantId},
        ${r.gtin},
        ${r.providerKey},
        ${r.status},
        ${r.kickdbVariantId ?? null},
        ${now},
        ${now}
      )`
  );
  const insertQuery = Prisma.sql`
    WITH ins AS (
      INSERT INTO "public"."VariantMapping" (
        "id",
        "supplierVariantId",
        "gtin",
        "providerKey",
        "status",
        "kickdbVariantId",
        "createdAt",
        "updatedAt"
      )
      VALUES ${Prisma.join(insertValues)}
      ON CONFLICT ("supplierVariantId") DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*)::int AS "count" FROM ins;
  `;
  const insRes = await prisma.$queryRaw<Array<{ count: number }>>(insertQuery);
  const inserted = insRes?.[0]?.count ?? 0;

  // Update existing mappings only when changed. Avoid downgrades from MATCHED/AMBIGUOUS/SUPPLIER_GTIN/PARTNER_GTIN.
  const updateValues = rowsDeduped.map((r) =>
    Prisma.sql`(${r.supplierVariantId}, ${r.gtin}, ${r.providerKey}, ${r.status}, ${r.kickdbVariantId ?? null})`
  );
  const updateQuery = Prisma.sql`
    WITH vals ("supplierVariantId","gtin","providerKey","status","kickdbVariantId") AS (
      VALUES ${Prisma.join(updateValues)}
    ),
    upd AS (
      UPDATE "public"."VariantMapping" AS m
      SET
        "gtin" = CASE
          WHEN vals."gtin" IS NULL THEN m."gtin"
          ELSE vals."gtin"
        END,
        "providerKey" = CASE
          WHEN vals."gtin" IS NULL AND m."gtin" IS NULL THEN NULL
          WHEN vals."providerKey" IS NULL THEN m."providerKey"
          ELSE vals."providerKey"
        END,
        "kickdbVariantId" = CASE
          WHEN vals."kickdbVariantId" IS NULL THEN m."kickdbVariantId"
          ELSE vals."kickdbVariantId"
        END,
        "status" = CASE
          WHEN ${onlySetPendingIfMissing} AND vals."status" = 'PENDING_GTIN'
            AND m."status" IS NOT NULL AND m."status" <> 'PENDING_GTIN'
          THEN m."status"
          WHEN ${doNotDowngrade}
            AND vals."status" = 'PENDING_GTIN'
            AND m."status" IN ('MATCHED','AMBIGUOUS_GTIN','SUPPLIER_GTIN','PARTNER_GTIN')
          THEN m."status"
          ELSE vals."status"
        END,
        "updatedAt" = ${now}
      FROM vals
      WHERE m."supplierVariantId" = vals."supplierVariantId"
        AND (
          m."gtin" IS DISTINCT FROM CASE
            WHEN vals."gtin" IS NULL THEN m."gtin"
            ELSE vals."gtin"
          END
          OR m."providerKey" IS DISTINCT FROM CASE
            WHEN vals."gtin" IS NULL AND m."gtin" IS NULL THEN NULL
            WHEN vals."providerKey" IS NULL THEN m."providerKey"
            ELSE vals."providerKey"
          END
          OR m."kickdbVariantId" IS DISTINCT FROM CASE
            WHEN vals."kickdbVariantId" IS NULL THEN m."kickdbVariantId"
            ELSE vals."kickdbVariantId"
          END
          OR m."status" IS DISTINCT FROM CASE
            WHEN ${onlySetPendingIfMissing} AND vals."status" = 'PENDING_GTIN'
              AND m."status" IS NOT NULL AND m."status" <> 'PENDING_GTIN'
            THEN m."status"
            WHEN ${doNotDowngrade}
              AND vals."status" = 'PENDING_GTIN'
              AND m."status" IN ('MATCHED','AMBIGUOUS_GTIN','SUPPLIER_GTIN','PARTNER_GTIN')
            THEN m."status"
            ELSE vals."status"
          END
        )
      RETURNING 1
    )
    SELECT COUNT(*)::int AS "count" FROM upd;
  `;
  const updRes = await prisma.$queryRaw<Array<{ count: number }>>(updateQuery);
  const updated = updRes?.[0]?.count ?? 0;
  return { inserted, updated };
}

export function createLimiter(concurrency: number) {
  const limit = Math.max(1, concurrency);
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit) return;
    const job = queue.shift();
    if (!job) return;
    active += 1;
    job();
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
  };
}

