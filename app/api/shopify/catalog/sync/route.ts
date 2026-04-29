import { NextResponse } from "next/server";
import { syncShopifyCatalog } from "@/shopify/catalog/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseBool(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return undefined;
}

function parseProviderKeys(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSupplierKey(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const key = String(value).trim().toLowerCase();
  return key || undefined;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "500");
    const offset = Number(searchParams.get("offset") ?? "0");
    const dryRun = parseBool(searchParams.get("dryRun"));
    const providerKeys = [
      ...parseProviderKeys(searchParams.get("providerKeys")),
      ...parseProviderKeys(searchParams.get("providerKey")),
    ];
    const supplierKey = parseSupplierKey(searchParams.get("supplierKey"));
    const inStockOnly = parseBool(searchParams.get("inStockOnly"));
    const missingOnly = parseBool(searchParams.get("missingOnly"));

    const result = await syncShopifyCatalog({
      limit,
      offset,
      providerKeys,
      supplierKey,
      inStockOnly,
      missingOnly,
      dryRun,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("[SHOPIFY][CATALOG][SYNC] GET failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Shopify catalog sync failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const providerKeys = [
      ...parseProviderKeys(body?.providerKeys),
      ...parseProviderKeys(body?.providerKey),
    ];
    const result = await syncShopifyCatalog({
      limit: Number(body?.limit ?? 500),
      offset: Number(body?.offset ?? 0),
      providerKeys,
      supplierKey: parseSupplierKey(body?.supplierKey),
      inStockOnly: parseBool(body?.inStockOnly),
      missingOnly: parseBool(body?.missingOnly),
      dryRun: parseBool(body?.dryRun),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("[SHOPIFY][CATALOG][SYNC] POST failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Shopify catalog sync failed" },
      { status: 500 }
    );
  }
}
