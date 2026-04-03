import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toCsv } from "@/galaxus/exports/csv";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { validateGtin } from "@/app/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();
  const q = (searchParams.get("q") ?? "").trim();
  const download = ["1", "true", "yes"].includes((searchParams.get("download") ?? "").toLowerCase());

  const whereSupplier = supplier
    ? { supplierVariant: { supplierVariantId: { startsWith: `${supplier}:` } } }
    : {};

  const where: Record<string, unknown> = {
    ...whereSupplier,
  };
  if (q) {
    where.OR = [
      { supplierVariantId: { contains: q, mode: "insensitive" } },
      { providerKey: { contains: q, mode: "insensitive" } },
      { gtin: { contains: q, mode: "insensitive" } },
      { supplierVariant: { supplierSku: { contains: q, mode: "insensitive" } } },
      { supplierVariant: { supplierProductName: { contains: q, mode: "insensitive" } } },
    ];
  }

  const items = download
    ? []
    : await (prisma as any).variantMapping.findMany({
        where,
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

  const prismaAny = prisma as any;
  const variantWhere = supplier
    ? { supplierVariantId: { startsWith: `${supplier}:` } }
    : {};
  const variants = await prismaAny.supplierVariant.findMany({
    where: variantWhere,
    orderBy: { updatedAt: "desc" },
  });
  const variantIds = variants.map((v: any) => v.supplierVariantId).filter(Boolean);
  const mappingItems =
    variantIds.length > 0
      ? await prismaAny.variantMapping.findMany({
          where: { supplierVariantId: { in: variantIds } },
          include: { kickdbVariant: { include: { product: true } } },
        })
      : [];
  const mappingByVariantId = new Map<string, any>();
  for (const m of mappingItems) {
    if (m.supplierVariantId) mappingByVariantId.set(m.supplierVariantId, m);
  }

  const rows = variants.map((sv: any) => {
    const m = mappingByVariantId.get(sv.supplierVariantId) ?? null;
    const kv = m?.kickdbVariant ?? null;
    const kp = kv?.product ?? null;
    const computedProviderKey = buildProviderKey(m?.gtin ?? null, sv?.supplierVariantId ?? null);
    return {
      status: m?.status ?? "",
      updatedAt: m?.updatedAt ?? sv?.updatedAt ?? "",
      supplierVariantId: sv?.supplierVariantId ?? "",
      providerKey: computedProviderKey ?? m?.providerKey ?? "",
      gtin: m?.gtin ?? sv?.gtin ?? "",
      supplierSku: sv?.supplierSku ?? "",
      supplierBrand: sv?.supplierBrand ?? "",
      supplierProductName: sv?.supplierProductName ?? "",
      sizeRaw: sv?.sizeRaw ?? "",
      price: sv?.price ?? "",
      stock: sv?.stock ?? "",
      lastSyncAt: sv?.lastSyncAt ?? "",
      kickdbVariantId: kv?.kickdbVariantId ?? "",
      kickdbProductId: kp?.kickdbProductId ?? "",
      kickdbBrand: kp?.brand ?? "",
      kickdbName: kp?.name ?? "",
      kickdbStyleId: kp?.styleId ?? "",
      kickdbUrlKey: kp?.urlKey ?? "",
      kickdbImageUrl: kp?.imageUrl ?? "",
      kickdbLastFetchedAt: kp?.lastFetchedAt ?? "",
      kickdbNotFound: kp?.notFound ?? "",
      kickdbDescription: kp?.description ?? "",
      kickdbGender: kp?.gender ?? "",
      kickdbColorway: kp?.colorway ?? "",
      kickdbCountryOfManufacture: kp?.countryOfManufacture ?? "",
      kickdbReleaseDate: kp?.releaseDate ?? "",
      kickdbRetailPrice: kp?.retailPrice ?? "",
    };
  });

  const csv = toCsv(headers, rows);
  const filename = `galaxus-mappings-${supplier ?? "all"}-${Date.now()}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

type UpdatePayload = {
  id?: string;
  supplierVariantId?: string;
  gtin?: string | null;
  status?: string | null;
  kickdbVariantId?: string | null;
};

function normalizeGtin(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw ? raw : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      updates?: UpdatePayload[];
      createIfMissing?: boolean;
    };
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const createIfMissing = body.createIfMissing !== false;
    if (updates.length === 0) {
      return NextResponse.json({ ok: false, error: "No updates provided" }, { status: 400 });
    }

    const results = await prisma.$transaction(
      async (tx) => {
        const output: Array<Record<string, unknown>> = [];
        for (const entry of updates) {
          const id = String(entry.id ?? "").trim();
          const supplierVariantId = String(entry.supplierVariantId ?? "").trim();
          if (!id && !supplierVariantId) {
            output.push({ ok: false, error: "Missing id or supplierVariantId" });
            continue;
          }

          const existing = id
            ? await (tx as any).variantMapping.findUnique({ where: { id } })
            : await (tx as any).variantMapping.findUnique({
                where: { supplierVariantId: supplierVariantId || undefined },
              });

          if (!existing && !createIfMissing) {
            output.push({ ok: false, error: "Mapping not found", supplierVariantId });
            continue;
          }

          const normalizedGtin = "gtin" in entry ? normalizeGtin(entry.gtin ?? null) : undefined;
          if (normalizedGtin && !validateGtin(normalizedGtin)) {
            output.push({
              ok: false,
              error: "Invalid GTIN",
              supplierVariantId: supplierVariantId || existing?.supplierVariantId || null,
            });
            continue;
          }
          const mappingSupplierVariantId =
            supplierVariantId || existing?.supplierVariantId || "";
          const computedProviderKey =
            normalizedGtin === undefined
              ? undefined
              : normalizedGtin
                ? buildProviderKey(normalizedGtin, mappingSupplierVariantId) ?? null
                : null;
          if (normalizedGtin && !computedProviderKey) {
            output.push({
              ok: false,
              error: "Failed to build providerKey from GTIN",
              supplierVariantId: mappingSupplierVariantId || null,
            });
            continue;
          }

          const statusValue =
            "status" in entry
              ? entry.status ?? null
              : normalizedGtin
                ? "SUPPLIER_GTIN"
                : "PENDING_GTIN";

          if (existing) {
            const data: Record<string, unknown> = {};
            if ("gtin" in entry) data.gtin = normalizedGtin ?? null;
            if ("gtin" in entry) data.providerKey = computedProviderKey ?? null;
            if ("status" in entry || "gtin" in entry) data.status = statusValue ?? existing.status;
            if ("kickdbVariantId" in entry) data.kickdbVariantId = entry.kickdbVariantId ?? null;
            const keysTouched = Object.keys(data);
            if (keysTouched.length === 0) {
              output.push({ ok: true, skipped: true, supplierVariantId: existing.supplierVariantId });
              continue;
            }
            const updated = await (tx as any).variantMapping.update({
              where: { id: existing.id },
              data,
            });
            output.push({ ok: true, item: updated });
          } else {
            const created = await (tx as any).variantMapping.create({
              data: {
                supplierVariantId: mappingSupplierVariantId || null,
                gtin: normalizedGtin ?? null,
                providerKey: computedProviderKey ?? null,
                status: statusValue ?? "PENDING_GTIN",
                kickdbVariantId: entry.kickdbVariantId ?? null,
              },
            });
            output.push({ ok: true, item: created });
          }
        }
        return output;
      },
      { maxWait: 15000, timeout: 60000 }
    );

    const failed = results.filter((r: any) => r && r.ok === false);
    return NextResponse.json({
      ok: failed.length === 0,
      results,
      ...(failed.length > 0
        ? { error: failed.map((f: any) => `${f.supplierVariantId ?? "?"}: ${f.error}`).join("; ") }
        : {}),
    });
  } catch (error: any) {
    console.error("[GALAXUS][SUPPLIER][MAPPINGS] Update failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Update failed" },
      { status: 500 }
    );
  }
}

