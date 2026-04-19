import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { resolveSupplierVariant } from "@/galaxus/supplier/orders";
import { createGoldenSupplierClient } from "@/galaxus/supplier/client";
import { createTrmSupplierClient } from "@/galaxus/supplier/trmClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LiveStockResult = {
  status: "OK" | "OUT_OF_STOCK" | "UNKNOWN" | "NO_VARIANT";
  stock: number | null;
  available: boolean | null;
  supplierSku?: string | null;
  source: "live" | "db";
  debugVariants?: Array<{
    sizeUs?: string | null;
    sizeEu?: string | null;
    stock: number | null;
  }>;
  requestedSizeRaw?: string | null;
  requestedSizeNormalized?: string;
  noResponseReason?: string;
  triedSkus?: string[];
};

function toPositiveInt(value: unknown, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeSize(value?: string | null): string {
  if (!value) return "";
  return String(value)
    .toLowerCase()
    .replace(/\b(us|eu|men|women|w|m)\b/g, "")
    .replace(/[^\d.]/g, "")
    .trim();
}

function resolveSupplierKeyFromVariantId(supplierVariantId?: string | null): string | null {
  if (!supplierVariantId) return null;
  const raw = supplierVariantId.trim();
  const prefix = raw.includes(":") ? raw.split(":")[0] : raw.includes("_") ? raw.split("_")[0] : raw;
  return prefix ? prefix.trim().toLowerCase() : null;
}

function resolveSupplierKeyFromLine(line: { supplierPid?: string | null; supplierVariantId?: string | null }) {
  const pid = String(line.supplierPid ?? "").trim();
  if (pid) {
    const prefix = pid.includes(":") ? pid.split(":")[0] : pid.includes("_") ? pid.split("_")[0] : pid;
    if (prefix) return prefix.trim().toLowerCase();
  }
  return resolveSupplierKeyFromVariantId(line.supplierVariantId);
}

function normalizeSupplierKey(raw?: string | null): string | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (key === "gld") return "golden";
  return key;
}

function pickPreferredSku(rawSku?: string | null): string {
  const sku = String(rawSku ?? "").trim();
  if (!sku) return "";
  if (sku.includes("/")) {
    const parts = sku
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) return parts[parts.length - 1];
  }
  return sku;
}

function buildSkuCandidates(rawSku?: string | null): string[] {
  const sku = String(rawSku ?? "").trim();
  if (!sku) return [];
  const out: string[] = [];
  const push = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    if (!out.includes(normalized)) out.push(normalized);
  };
  push(sku);
  if (sku.includes("/")) {
    const parts = sku
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      push(parts[0]);
      push(parts[parts.length - 1]);
    }
  }
  const preferred = pickPreferredSku(sku);
  push(preferred);
  return out;
}

let goldenCache: { fetchedAt: number; items: Awaited<ReturnType<ReturnType<typeof createGoldenSupplierClient>["fetchStockAndPrice"]>> } | null =
  null;

async function fetchGoldenStockBySkuSize(params: {
  sku: string;
  sizeRaw?: string | null;
}): Promise<LiveStockResult> {
  const sizeNeedle = normalizeSize(params.sizeRaw);
  const now = Date.now();
  if (!goldenCache || now - goldenCache.fetchedAt > 60_000) {
    const client = createGoldenSupplierClient();
    const items = await client.fetchStockAndPrice();
    goldenCache = { fetchedAt: now, items };
  }
  const skuCandidates = buildSkuCandidates(params.sku);
  const skuNeedles = new Set(skuCandidates.map((candidate) => candidate.toLowerCase()));
  const items = goldenCache.items.filter((item) =>
    skuNeedles.has(String(item.supplierSku ?? "").trim().toLowerCase())
  );
  if (items.length === 0) {
    return {
      status: "NO_VARIANT",
      stock: null,
      available: null,
      source: "live",
      debugVariants: [],
      requestedSizeRaw: params.sizeRaw ?? null,
      requestedSizeNormalized: sizeNeedle,
    };
  }
  const debugVariants = items.map((item) => ({
    sizeUs: null,
    sizeEu: item.sizeRaw ?? null,
    stock: typeof item.stock === "number" ? item.stock : null,
  }));
  const matched =
    sizeNeedle.length > 0
      ? items.find((item) => normalizeSize(item.sizeRaw) === sizeNeedle)
      : items[0];
  if (!matched) {
    return {
      status: "NO_VARIANT",
      stock: null,
      available: null,
      source: "live",
      debugVariants,
      requestedSizeRaw: params.sizeRaw ?? null,
      requestedSizeNormalized: sizeNeedle,
    };
  }
  const stock = typeof matched.stock === "number" ? matched.stock : null;
  const available = stock === null ? null : stock >= 1;
  return {
    status: stock === null ? "UNKNOWN" : available ? "OK" : "OUT_OF_STOCK",
    stock,
    available,
    supplierSku: matched.supplierSku ?? null,
    source: "live",
    debugVariants,
    requestedSizeRaw: params.sizeRaw ?? null,
    requestedSizeNormalized: sizeNeedle,
  };
}

async function fetchTrmStockBySkuSize(params: {
  sku: string;
  sizeRaw?: string | null;
}): Promise<LiveStockResult> {
  const sizeNeedle = normalizeSize(params.sizeRaw);
  const client = createTrmSupplierClient();
  const skuCandidates = buildSkuCandidates(params.sku);
  const triedSkus: string[] = [];
  let product: Awaited<ReturnType<ReturnType<typeof createTrmSupplierClient>["fetchProductBySku"]>> = null;
  let resolvedSku = "";
  for (const sku of skuCandidates) {
    triedSkus.push(sku);
    try {
      const found = await client.fetchProductBySku(sku);
      if (found) {
        product = found;
        resolvedSku = sku;
        break;
      }
    } catch (error: any) {
      const message = String(error?.message ?? "");
      if (message.includes("TRM product fetch failed (404)")) {
        continue;
      }
      throw error;
    }
  }
  if (!product) {
    return {
      status: "NO_VARIANT",
      stock: null,
      available: null,
      source: "live",
      debugVariants: [],
      requestedSizeRaw: params.sizeRaw ?? null,
      requestedSizeNormalized: sizeNeedle,
      noResponseReason: "TRM_SKU_NOT_FOUND",
      triedSkus,
    };
  }
  const variants = product.variants ?? [];
  const debugVariants = variants.map((variant) => ({
    sizeUs: variant.size ?? null,
    sizeEu: variant.eu_size ?? null,
    stock: typeof variant.stock === "number" ? variant.stock : null,
  }));
  const matched =
    sizeNeedle.length > 0
      ? variants.find((variant) => {
          const eu = normalizeSize(variant.eu_size ?? null);
          const raw = normalizeSize(variant.size ?? null);
          return eu === sizeNeedle || raw === sizeNeedle;
        })
      : variants[0];
  if (!matched) {
    return {
      status: "NO_VARIANT",
      stock: null,
      available: null,
      source: "live",
      debugVariants,
      requestedSizeRaw: params.sizeRaw ?? null,
      requestedSizeNormalized: sizeNeedle,
      triedSkus: [resolvedSku || product.sku],
    };
  }
  const stock = typeof matched.stock === "number" ? matched.stock : null;
  const available = stock === null ? null : stock >= 1;
  return {
    status: stock === null ? "UNKNOWN" : available ? "OK" : "OUT_OF_STOCK",
    stock,
    available,
    supplierSku: product.sku ?? null,
    source: "live",
    debugVariants,
    requestedSizeRaw: params.sizeRaw ?? null,
    requestedSizeNormalized: sizeNeedle,
    triedSkus: [resolvedSku || product.sku],
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string; lineId: string }> }
) {
  try {
    const { orderId, lineId } = await params;

    const order =
      (await prisma.galaxusOrder.findUnique({
        where: { id: orderId },
        select: { id: true, galaxusOrderId: true },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: orderId },
        select: { id: true, galaxusOrderId: true },
      }));

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const line = await prisma.galaxusOrderLine.findFirst({
      where: { id: lineId, orderId: order.id },
    });
    if (!line) {
      return NextResponse.json({ ok: false, error: "Order line not found" }, { status: 404 });
    }

    const supplierVariant = await resolveSupplierVariant(line);
    if (!supplierVariant) {
      return NextResponse.json({
        ok: true,
        status: "NO_VARIANT",
        lineId: line.id,
        requestedQty: toPositiveInt(line.quantity, 1),
        stock: null,
        available: null,
      });
    }

    const supplierKey = normalizeSupplierKey(
      resolveSupplierKeyFromLine({
      supplierPid: line.supplierPid ?? null,
      supplierVariantId: supplierVariant.supplierVariantId ?? null,
      })
    );
    const sizeHint = supplierVariant.sizeRaw ?? line.size ?? null;
    if (supplierKey === "golden") {
      const skuRaw = supplierVariant.supplierSku ?? line.supplierSku ?? "";
      const live = await fetchGoldenStockBySkuSize({
        sku: pickPreferredSku(skuRaw),
        sizeRaw: sizeHint,
      });
      return NextResponse.json({
        ok: true,
        lineId: line.id,
        supplierVariantId: supplierVariant.supplierVariantId,
        supplierSku: live.supplierSku ?? supplierVariant.supplierSku ?? null,
        requestedQty: toPositiveInt(line.quantity, 1),
        stock: live.stock,
        available: live.available,
        status: live.status,
        source: live.source,
        debugVariants: live.debugVariants ?? [],
        requestedSizeRaw: live.requestedSizeRaw ?? sizeHint,
        requestedSizeNormalized: live.requestedSizeNormalized ?? normalizeSize(sizeHint),
      });
    }

    if (supplierKey === "trm") {
      const skuRaw = supplierVariant.supplierSku ?? line.supplierSku ?? "";
      const live = await fetchTrmStockBySkuSize({
        sku: skuRaw,
        sizeRaw: sizeHint,
      });
      return NextResponse.json({
        ok: true,
        lineId: line.id,
        supplierVariantId: supplierVariant.supplierVariantId,
        supplierSku: live.supplierSku ?? supplierVariant.supplierSku ?? null,
        requestedQty: toPositiveInt(line.quantity, 1),
        stock: live.stock,
        available: live.available,
        status: live.status,
        source: live.source,
        debugVariants: live.debugVariants ?? [],
        requestedSizeRaw: live.requestedSizeRaw ?? sizeHint,
        requestedSizeNormalized: live.requestedSizeNormalized ?? normalizeSize(sizeHint),
        noResponseReason: live.noResponseReason ?? null,
        triedSkus: live.triedSkus ?? [],
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Live stock check not supported for this supplier",
        supplierKey,
      },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[GALAXUS][ORDERS] Stock check failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to check stock" },
      { status: 500 }
    );
  }
}
