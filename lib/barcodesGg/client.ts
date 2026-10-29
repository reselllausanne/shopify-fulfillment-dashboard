import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { pickAllValidGtins, normalizeStyleCode } from "@/lib/barcodesGg/gtinPick";
import type {
  BarcodesGgCacheStatus,
  BarcodesGgProductDetails,
  PickedGtin,
} from "@/lib/barcodesGg/types";

const BASE = "https://barcodes.gg/api/v2";

function apiKey(): string {
  const key = String(process.env.BARCODES_GG_API_KEY ?? "").trim();
  if (!key) throw new Error("BARCODES_GG_API_KEY missing");
  return key;
}

export type StyleLookupResult = {
  styleCode: string;
  status: BarcodesGgCacheStatus;
  fromCache: boolean;
  requestDebited: boolean;
  picks: PickedGtin[];
  productName: string | null;
  errorMessage: string | null;
  response: BarcodesGgProductDetails | null;
};

type CacheRow = {
  styleCode: string;
  status: string;
  responseJson: unknown;
  productName: string | null;
  errorMessage: string | null;
  requestDebited: boolean;
  refreshAfter: Date | null;
};

function picksFromResponse(body: BarcodesGgProductDetails | null): PickedGtin[] {
  return pickAllValidGtins(body?.product?.sizes ?? []);
}

function mapCache(row: CacheRow): StyleLookupResult {
  const response = (row.responseJson as BarcodesGgProductDetails | null) ?? null;
  return {
    styleCode: row.styleCode,
    status: row.status as BarcodesGgCacheStatus,
    fromCache: true,
    requestDebited: false,
    picks: row.status === "found" ? picksFromResponse(response) : [],
    productName: row.productName,
    errorMessage: row.errorMessage,
    response,
  };
}

async function readCache(styleCode: string): Promise<CacheRow | null> {
  const rows = await prisma.$queryRaw<CacheRow[]>`
    SELECT "styleCode", status, "responseJson", "productName", "errorMessage",
           "requestDebited", "refreshAfter"
    FROM "BarcodesGgStyleCache"
    WHERE "styleCode" = ${styleCode}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function upsertCache(input: {
  styleCode: string;
  status: BarcodesGgCacheStatus;
  body: BarcodesGgProductDetails | null;
  httpStatus: number | null;
  requestDebited: boolean;
  errorMessage: string | null;
}): Promise<void> {
  const sizes = input.body?.product?.sizes ?? [];
  const picks = input.status === "found" ? pickAllValidGtins(sizes) : [];
  const product = input.body?.product;
  const id = crypto.randomUUID();
  const now = new Date();
  const responseJson = input.body ? JSON.stringify(input.body) : null;
  const refreshAfter =
    input.status === "not_found"
      ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      : null;

  await prisma.$executeRaw`
    INSERT INTO "BarcodesGgStyleCache" (
      id, "styleCode", status, "productUniqueId", "productName", "productBrand",
      "responseJson", "sizesTotal", "sizesWithValidGtin", "requestDebited",
      "httpStatus", "errorMessage", "lookedUpAt", "refreshAfter", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${input.styleCode}, ${input.status},
      ${product?.product_unique_id ?? null},
      ${product?.title ?? null},
      ${product?.brand ?? null},
      ${responseJson}::jsonb,
      ${sizes.length},
      ${picks.length},
      ${input.requestDebited},
      ${input.httpStatus},
      ${input.errorMessage},
      ${now},
      ${refreshAfter},
      ${now},
      ${now}
    )
    ON CONFLICT ("styleCode") DO UPDATE SET
      status = EXCLUDED.status,
      "productUniqueId" = EXCLUDED."productUniqueId",
      "productName" = EXCLUDED."productName",
      "productBrand" = EXCLUDED."productBrand",
      "responseJson" = EXCLUDED."responseJson",
      "sizesTotal" = EXCLUDED."sizesTotal",
      "sizesWithValidGtin" = EXCLUDED."sizesWithValidGtin",
      "requestDebited" = EXCLUDED."requestDebited",
      "httpStatus" = EXCLUDED."httpStatus",
      "errorMessage" = EXCLUDED."errorMessage",
      "lookedUpAt" = EXCLUDED."lookedUpAt",
      "refreshAfter" = EXCLUDED."refreshAfter",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
}

/** GET /token/usage — not debited. */
export async function fetchTokenUsage(): Promise<{
  remaining: number;
  usedThisCycle: number;
  planLimit: number;
  rateLimit: number;
}> {
  const res = await fetch(`${BASE}/token/usage`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const body = (await res.json()) as any;
  const calls = body?.usage?.calls ?? {};
  return {
    remaining: Number(calls.remaining ?? 0),
    usedThisCycle: Number(calls.used_this_cycle ?? 0),
    planLimit: Number(calls.plan_limit ?? 0),
    rateLimit: Number(body?.usage?.plan?.rate_limit ?? 60),
  };
}

/**
 * One call per style via /product/details/{style}.
 * Returns cached hit/miss without re-calling (unless refreshAfter passed or force).
 */
export async function lookupStyleDetails(
  rawStyle: string,
  opts?: { force?: boolean; skipCacheWrite?: boolean }
): Promise<StyleLookupResult> {
  const styleCode = normalizeStyleCode(rawStyle);
  if (!styleCode) {
    return {
      styleCode: "",
      status: "error",
      fromCache: false,
      requestDebited: false,
      picks: [],
      productName: null,
      errorMessage: "empty style code",
      response: null,
    };
  }

  if (!opts?.force) {
    const cached = await readCache(styleCode);
    if (cached) {
      const expired =
        cached.refreshAfter != null && cached.refreshAfter.getTime() <= Date.now();
      if (!expired) return mapCache(cached);
    }
  }

  const url = `${BASE}/product/details/${encodeURIComponent(styleCode)}`;
  let httpStatus = 0;
  let body: BarcodesGgProductDetails | null = null;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    httpStatus = res.status;
    body = (await res.json()) as BarcodesGgProductDetails;
  } catch (e: any) {
    const result: StyleLookupResult = {
      styleCode,
      status: "error",
      fromCache: false,
      requestDebited: false,
      picks: [],
      productName: null,
      errorMessage: e?.message ?? String(e),
      response: null,
    };
    if (!opts?.skipCacheWrite) {
      await upsertCache({
        styleCode,
        status: "error",
        body: null,
        httpStatus: null,
        requestDebited: false,
        errorMessage: result.errorMessage,
      });
    }
    return result;
  }

  const debited = Boolean(body?.request_debited);
  let status: BarcodesGgCacheStatus = "found";
  let errorMessage: string | null = null;

  if (httpStatus >= 400 || body?.error === true || !body?.product) {
    // Not found is still "fulfilled"; store as not_found so we never re-burn.
    const msg = String(body?.message ?? `http ${httpStatus}`);
    errorMessage = msg;
    status =
      httpStatus === 429 || httpStatus === 403
        ? "error"
        : /could not be found|do not hold/i.test(msg) || body?.error === true
          ? "not_found"
          : "error";
  }

  const picks = status === "found" ? picksFromResponse(body) : [];
  // Details returned product but zero valid GTINs → still "found" (don't re-call);
  // sizes exist, just unusable barcodes.

  if (!opts?.skipCacheWrite && status !== "error") {
    await upsertCache({
      styleCode,
      status,
      body,
      httpStatus,
      requestDebited: debited,
      errorMessage,
    });
  } else if (!opts?.skipCacheWrite && status === "error" && httpStatus !== 429) {
    await upsertCache({
      styleCode,
      status,
      body,
      httpStatus,
      requestDebited: debited,
      errorMessage,
    });
  }

  return {
    styleCode,
    status,
    fromCache: false,
    requestDebited: debited,
    picks,
    productName: body?.product?.title ?? null,
    errorMessage,
    response: body,
  };
}
