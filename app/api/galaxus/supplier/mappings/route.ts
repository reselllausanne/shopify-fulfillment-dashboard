import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toCsv } from "@/galaxus/exports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();
  const download = ["1", "true", "yes"].includes((searchParams.get("download") ?? "").toLowerCase());

  const whereSupplier = supplier
    ? { supplierVariant: { supplierVariantId: { startsWith: `${supplier}:` } } }
    : {};

  const items = download
    ? await (prisma as any).variantMapping.findMany({
        where: {
          ...whereSupplier,
        },
        include: {
          supplierVariant: true,
          kickdbVariant: { include: { product: true } },
        },
        orderBy: { updatedAt: "desc" },
      })
    : await (prisma as any).variantMapping.findMany({
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

  const nextOffset = download ? null : items.length === limit ? offset + limit : null;

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

  if (!download) {
    return NextResponse.json({ ok: true, items: mapped, nextOffset });
  }

  const headers = [
    "status",
    "updatedAt",
    "supplierVariantId",
    "providerKey",
    "gtin",
    "supplierSku",
    "supplierBrand",
    "supplierProductName",
    "sizeRaw",
    "price",
    "stock",
    "lastSyncAt",
    "kickdbVariantId",
    "kickdbProductId",
    "kickdbBrand",
    "kickdbName",
    "kickdbStyleId",
    "kickdbUrlKey",
    "kickdbImageUrl",
    "kickdbLastFetchedAt",
    "kickdbNotFound",
    "kickdbDescription",
    "kickdbGender",
    "kickdbColorway",
    "kickdbCountryOfManufacture",
    "kickdbReleaseDate",
    "kickdbRetailPrice",
  ];

  const rows = mapped.map((row: (typeof mapped)[number]) => ({
    status: row.status ?? "",
    updatedAt: row.updatedAt ?? "",
    supplierVariantId: row.supplierVariantId ?? "",
    providerKey: row.providerKey ?? "",
    gtin: row.gtin ?? "",
    supplierSku: row.supplierSku ?? "",
    supplierBrand: row.supplierBrand ?? "",
    supplierProductName: row.supplierProductName ?? "",
    sizeRaw: row.sizeRaw ?? "",
    price: row.price ?? "",
    stock: row.stock ?? "",
    lastSyncAt: row.lastSyncAt ?? "",
    kickdbVariantId: row.kickdbVariantId ?? "",
    kickdbProductId: row.kickdbProductId ?? "",
    kickdbBrand: row.kickdbBrand ?? "",
    kickdbName: row.kickdbName ?? "",
    kickdbStyleId: row.kickdbStyleId ?? "",
    kickdbUrlKey: row.kickdbUrlKey ?? "",
    kickdbImageUrl: row.kickdbImageUrl ?? "",
    kickdbLastFetchedAt: row.kickdbLastFetchedAt ?? "",
    kickdbNotFound: row.kickdbNotFound ?? "",
    kickdbDescription: row.kickdbDescription ?? "",
    kickdbGender: row.kickdbGender ?? "",
    kickdbColorway: row.kickdbColorway ?? "",
    kickdbCountryOfManufacture: row.kickdbCountryOfManufacture ?? "",
    kickdbReleaseDate: row.kickdbReleaseDate ?? "",
    kickdbRetailPrice: row.kickdbRetailPrice ?? "",
  }));

  const csv = toCsv(headers, rows);
  const filename = `galaxus-mappings-${supplier ?? "all"}-${Date.now()}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

