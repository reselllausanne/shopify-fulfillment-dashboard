import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();

  const whereSupplier = supplier
    ? { supplierVariant: { supplierVariantId: { startsWith: `${supplier}:` } } }
    : {};

  const items = await (prisma as any).variantMapping.findMany({
    where: {
      ...whereSupplier,
    },
    include: {
      supplierVariant: true,
      kickdbVariant: { include: { product: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const nextOffset = items.length === limit ? offset + limit : null;

  const mapped = (items ?? []).map((m: any) => {
    const sv = m.supplierVariant ?? null;
    const kv = m.kickdbVariant ?? null;
    const kp = kv?.product ?? null;
    return {
      id: m.id,
      status: m.status ?? null,
      updatedAt: m.updatedAt ?? null,
      supplierVariantId: m.supplierVariantId,
      providerKey: m.providerKey ?? null,
      gtin: m.gtin ?? null,

      supplierSku: sv?.supplierSku ?? null,
      supplierBrand: sv?.supplierBrand ?? null,
      supplierProductName: sv?.supplierProductName ?? null,
      sizeRaw: sv?.sizeRaw ?? null,
      price: sv?.price ?? null,
      stock: sv?.stock ?? null,
      lastSyncAt: sv?.lastSyncAt ?? null,

      kickdbVariantId: kv?.kickdbVariantId ?? null,
      kickdbProductId: kp?.kickdbProductId ?? null,
      kickdbBrand: kp?.brand ?? null,
      kickdbName: kp?.name ?? null,
      kickdbStyleId: kp?.styleId ?? null,
      kickdbUrlKey: kp?.urlKey ?? null,
      kickdbImageUrl: kp?.imageUrl ?? null,
      kickdbLastFetchedAt: kp?.lastFetchedAt ?? null,
      kickdbNotFound: kp?.notFound ?? null,
      kickdbDescription: kp?.description ?? null,
      kickdbGender: kp?.gender ?? null,
      kickdbColorway: kp?.colorway ?? null,
      kickdbCountryOfManufacture: kp?.countryOfManufacture ?? null,
      kickdbReleaseDate: kp?.releaseDate ?? null,
      kickdbRetailPrice: kp?.retailPrice ?? null,
    };
  });

  return NextResponse.json({ ok: true, items: mapped, nextOffset });
}

