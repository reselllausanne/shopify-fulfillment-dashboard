import { prisma } from "@/app/lib/prisma";
import { kickdbUpsertGate } from "@/galaxus/kickdb/upsertGate";
import { upsertKickdbProductPayload } from "@/galaxus/kickdb/upsertProduct";

export function checkKickdbBufferAuth(headers: Record<string, string | string[] | undefined>): boolean {
  const expected = process.env.KICKDB_INTERNAL_TOKEN;
  if (!expected) return true;
  const token = headers["x-internal-token"];
  return token === expected;
}

/** Cheap check: known product with rawJson → SSE can fetch price-only. */
export async function queryKickdbExists(kickdbProductId: string): Promise<{
  ok: true;
  exists: boolean;
  priceOnly: boolean;
  ms: number;
}> {
  const startedAt = Date.now();
  const id = String(kickdbProductId ?? "").trim();
  if (!id) {
    return { ok: true, exists: false, priceOnly: false, ms: Date.now() - startedAt };
  }
  const rows = await prisma.$queryRaw<Array<{ hasRaw: boolean }>>`
    SELECT (
      "rawJson" IS NOT NULL
      AND jsonb_typeof("rawJson") = 'object'
    ) AS "hasRaw"
    FROM "public"."KickDBProduct"
    WHERE "kickdbProductId" = ${id}
    LIMIT 1
  `;
  const hasRaw = rows[0]?.hasRaw === true;
  return {
    ok: true,
    exists: rows.length > 0,
    priceOnly: hasRaw,
    ms: Date.now() - startedAt,
  };
}

export async function queryKickdbFreshProducts(params: {
  limit: number;
  status: string;
}): Promise<{ ok: true; count: number; products: unknown[]; ms: number }> {
  const startedAt = Date.now();
  const limit = Math.min(Math.max(params.limit, 1), 500);
  const status = params.status.trim() || "pending";

  type Row = {
    kickdbProductId: string;
    urlKey: string | null;
    styleId: string | null;
    name: string | null;
    rawJson: unknown;
    rawFetchedAt: Date | null;
    syncStatus: string;
    shopifyProductId: string | null;
    shopifyHandle: string | null;
    shopifySyncedAt: Date | null;
    priorityScore: number;
  };

  let rows: Row[];

  if (status === "untracked") {
    rows = await prisma.$queryRaw<Row[]>`
      SELECT
        p."kickdbProductId", p."urlKey", p."styleId", p."name",
        p."rawJson", p."rawFetchedAt",
        COALESCE(s."syncStatus", 'untracked')::text AS "syncStatus",
        s."shopifyProductId",
        s."shopifyHandle",
        s."shopifySyncedAt",
        COALESCE(s."priorityScore", 0)::int AS "priorityScore"
      FROM "public"."KickDBProduct" p
      LEFT JOIN "public"."ShopifySyncState" s
        ON s."kickdbProductId" = p."kickdbProductId"
      WHERE p."rawJson" IS NOT NULL
        AND (
          s."kickdbProductId" IS NULL
          OR s."syncStatus" = 'error'
          OR (
            s."syncStatus" = 'synced'
            AND (s."shopifyProductId" IS NULL OR BTRIM(s."shopifyProductId") = '')
          )
          OR (
            s."syncStatus" = 'blocked_no_images'
            AND s."shopifySyncedAt" IS NOT NULL
            AND p."rawFetchedAt" > s."shopifySyncedAt"
          )
        )
      ORDER BY p."updatedAt" DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await prisma.$queryRaw<Row[]>`
      SELECT
        p."kickdbProductId", p."urlKey", p."styleId", p."name",
        p."rawJson", p."rawFetchedAt",
        s."syncStatus", s."shopifyProductId", s."shopifyHandle",
        s."shopifySyncedAt", s."priorityScore"
      FROM "public"."ShopifySyncState" s
      INNER JOIN "public"."KickDBProduct" p
        ON p."kickdbProductId" = s."kickdbProductId"
      WHERE p."rawJson" IS NOT NULL
        AND (
          CASE
            WHEN ${status} = 'create_candidate' THEN s."syncStatus" = 'create_candidate'
            ELSE s."syncStatus" IN ('pending', 'synced', 'error')
              AND (s."shopifySyncedAt" IS NULL OR p."rawFetchedAt" > s."shopifySyncedAt")
          END
        )
      ORDER BY s."priorityScore" DESC, p."rawFetchedAt" DESC
      LIMIT ${limit}
    `;
  }

  return { ok: true, count: rows.length, products: rows, ms: Date.now() - startedAt };
}

export async function markKickdbProductSynced(body: Record<string, unknown>): Promise<{
  ok: true;
  kickdbProductId: string;
  syncStatus: string;
}> {
  const kickdbProductId =
    typeof body?.kickdbProductId === "string" ? body.kickdbProductId.trim() : "";
  if (!kickdbProductId) throw new Error("missing_kickdbProductId");

  const isError = Boolean(body?.error);
  const permanent = Boolean(body?.permanent);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const isBlockedNoImages = permanent && reason === "no_images";
  const shopifyProductId =
    typeof body?.shopifyProductId === "string" && body.shopifyProductId.trim()
      ? body.shopifyProductId.trim()
      : null;
  const shopifyHandle = typeof body?.shopifyHandle === "string" ? body.shopifyHandle : null;
  const syncStatus = isBlockedNoImages ? "blocked_no_images" : isError ? "error" : "synced";
  const lastError = isBlockedNoImages
    ? `blocked_no_images: ${reason}`
    : isError
      ? String(body.error).slice(0, 2000)
      : null;
  const now = new Date();

  await prisma.$executeRaw`
    INSERT INTO "public"."ShopifySyncState" (
      "id", "kickdbProductId", "shopifyProductId", "shopifyHandle",
      "syncStatus", "shopifySyncedAt", "lastError", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(),
      ${kickdbProductId},
      ${shopifyProductId},
      ${shopifyHandle},
      CASE
        WHEN ${syncStatus} = 'synced' AND ${shopifyProductId}::text IS NULL
        THEN 'error'
        ELSE ${syncStatus}
      END,
      ${now},
      CASE
        WHEN ${syncStatus} = 'synced' AND ${shopifyProductId}::text IS NULL
        THEN 'missing_shopify_product_id'
        ELSE ${lastError}
      END,
      ${now},
      ${now}
    )
    ON CONFLICT ("kickdbProductId") DO UPDATE SET
      "shopifyProductId" = COALESCE(EXCLUDED."shopifyProductId", "ShopifySyncState"."shopifyProductId"),
      "shopifyHandle"    = COALESCE(EXCLUDED."shopifyHandle", "ShopifySyncState"."shopifyHandle"),
      "syncStatus"       = CASE
        WHEN ${syncStatus} = 'synced'
          AND COALESCE(EXCLUDED."shopifyProductId", "ShopifySyncState"."shopifyProductId") IS NULL
        THEN 'error'
        WHEN ${syncStatus} = 'synced'
        THEN 'synced'
        ELSE ${syncStatus}
      END,
      "shopifySyncedAt"  = EXCLUDED."shopifySyncedAt",
      "lastError"        = CASE
        WHEN ${syncStatus} = 'synced'
          AND COALESCE(EXCLUDED."shopifyProductId", "ShopifySyncState"."shopifyProductId") IS NULL
        THEN 'missing_shopify_product_id'
        WHEN ${syncStatus} = 'synced'
        THEN NULL
        ELSE ${lastError}
      END,
      "updatedAt"        = EXCLUDED."updatedAt"
  `;

  return { ok: true, kickdbProductId, syncStatus };
}

export async function queryKickdbStaleProducts(params: {
  maxAgeDays: number;
  limit: number;
}): Promise<{ ok: true; count: number; products: unknown[]; ms: number }> {
  const startedAt = Date.now();
  const maxAgeDays = Math.min(Math.max(params.maxAgeDays, 1), 90);
  const limit = Math.min(Math.max(params.limit, 1), 10000);

  const rows = await prisma.$queryRaw<
    Array<{ kickdbProductId: string; urlKey: string | null; rawFetchedAt: Date | null }>
  >`
    SELECT p."kickdbProductId", p."urlKey", p."rawFetchedAt"
    FROM "public"."ShopifySyncState" s
    INNER JOIN "public"."KickDBProduct" p
      ON p."kickdbProductId" = s."kickdbProductId"
    WHERE p."rawFetchedAt" IS NULL
       OR p."rawFetchedAt" < NOW() - (${maxAgeDays} * INTERVAL '1 day')
    ORDER BY p."rawFetchedAt" ASC NULLS FIRST
    LIMIT ${limit}
  `;

  return { ok: true, count: rows.length, products: rows, ms: Date.now() - startedAt };
}

export async function queryKickdbNeedsRaw(params: {
  limit: number;
}): Promise<{ ok: true; count: number; products: unknown[]; ms: number }> {
  const startedAt = Date.now();
  const limit = Math.min(Math.max(params.limit, 1), 5000);

  const rows = await prisma.$queryRaw<
    Array<{ kickdbProductId: string; urlKey: string | null; styleId: string | null }>
  >`
    SELECT p."kickdbProductId", p."urlKey", p."styleId"
    FROM "public"."KickDBProduct" p
    LEFT JOIN "public"."ShopifySyncState" s
      ON s."kickdbProductId" = p."kickdbProductId"
    WHERE p."rawJson" IS NULL
      AND s."kickdbProductId" IS NULL
      AND p."notFound" = false
    ORDER BY p."lastFetchedAt" ASC NULLS FIRST
    LIMIT ${limit}
  `;

  return { ok: true, count: rows.length, products: rows, ms: Date.now() - startedAt };
}

export async function handleKickdbBufferRequest(
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
  body: unknown,
  headers: Record<string, string | string[] | undefined>
): Promise<{ status: number; json: unknown }> {
  if (method === "GET" && pathname === "/health") {
    return { status: 200, json: { ok: true, service: "kickdb-buffer" } };
  }

  if (!checkKickdbBufferAuth(headers)) {
    return { status: 401, json: { ok: false, error: "unauthorized" } };
  }

  if (method === "GET" && pathname === "/api/kickdb/exists") {
    const id = String(searchParams.get("id") ?? "").trim();
    if (!id) {
      return { status: 400, json: { ok: false, error: "missing_id" } };
    }
    const result = await queryKickdbExists(id);
    return { status: 200, json: result };
  }

  if (method === "POST" && pathname === "/api/kickdb/upsert") {
    const startedAt = Date.now();
    const gated = await kickdbUpsertGate.run(() =>
      upsertKickdbProductPayload({
        ...(body as { data?: unknown; notFound?: boolean; priceOnly?: boolean }),
        // Keep SSE hot path focused on DB writes; Shopify pricing runs async elsewhere.
        skipShopifyPriceSync: true,
      })
    );
    if (!gated.ok) {
      return { status: 503, json: { ok: false, error: "busy" } };
    }
    const result = gated.value;
    const id =
      result.ok && "kickdbProductId" in result
        ? result.kickdbProductId
        : null;
    console.info("[kickdb-buffer] upsert", {
      ok: result.ok,
      kickdbProductId: id,
      ms: Date.now() - startedAt,
      ...kickdbUpsertGate.snapshot(),
    });
    if (!result.ok) {
      const status = result.error === "missing_data_or_id" ? 400 : 500;
      return { status, json: result };
    }
    return { status: 200, json: result };
  }

  if (method === "GET" && pathname === "/api/kickdb/fresh") {
    const limit = Number(searchParams.get("limit") ?? 50);
    const status = searchParams.get("status") ?? "pending";
    const result = await queryKickdbFreshProducts({ limit, status });
    return { status: 200, json: result };
  }

  if (method === "POST" && pathname === "/api/kickdb/mark-synced") {
    try {
      const result = await markKickdbProductSynced(body as Record<string, unknown>);
      return { status: 200, json: result };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === "missing_kickdbProductId" ? 400 : 500;
      return { status, json: { ok: false, error: message } };
    }
  }

  if (method === "GET" && pathname === "/api/kickdb/stale") {
    const maxAgeDays = Number(searchParams.get("maxAgeDays") ?? 7);
    const limit = Number(searchParams.get("limit") ?? 3000);
    const result = await queryKickdbStaleProducts({ maxAgeDays, limit });
    return { status: 200, json: result };
  }

  if (method === "GET" && pathname === "/api/kickdb/needs-raw") {
    const limit = Number(searchParams.get("limit") ?? 500);
    const result = await queryKickdbNeedsRaw({ limit });
    return { status: 200, json: result };
  }

  return { status: 404, json: { ok: false, error: "not_found" } };
}
