import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAPPING_FIELDS = [
  "gtin",
  "providerKey",
  "status",
  "confidenceScore",
];

const KICKDB_VARIANT_FIELDS = [
  "sizeUs",
  "sizeEu",
  "gtin",
  "ean",
  "providerKey",
  "lastFetchedAt",
  "notFound",
];

const KICKDB_PRODUCT_FIELDS = [
  "urlKey",
  "styleId",
  "name",
  "brand",
  "imageUrl",
  "traitsJson",
  "description",
  "gender",
  "colorway",
  "countryOfManufacture",
  "releaseDate",
  "retailPrice",
  "lastFetchedAt",
  "notFound",
];

function pickFields<T extends Record<string, unknown>>(
  input: Record<string, unknown> | null | undefined,
  allowed: string[]
): T {
  const out: Record<string, unknown> = {};
  if (!input) return out as T;
  for (const key of allowed) {
    if (key in input) out[key] = input[key];
  }
  return out as T;
}

function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function toDecimalOrNull(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return null;
  return new Prisma.Decimal(parsed.toFixed(2));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const supplierVariantId = (searchParams.get("supplierVariantId") ?? "").trim();
  if (!supplierVariantId) {
    return NextResponse.json({ ok: false, error: "Missing supplierVariantId" }, { status: 400 });
  }

  const mapping = await prisma.variantMapping.findUnique({
    where: { supplierVariantId },
    include: { kickdbVariant: { include: { product: true } } },
  });

  if (!mapping) {
    return NextResponse.json({ ok: false, error: "Mapping not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    mapping: mapping ?? null,
    kickdbVariant: mapping.kickdbVariant ?? null,
    kickdbProduct: mapping.kickdbVariant?.product ?? null,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      supplierVariantId?: string;
      mapping?: Record<string, unknown>;
      kickdbVariant?: Record<string, unknown>;
      kickdbProduct?: Record<string, unknown>;
    };
    const supplierVariantId = String(body.supplierVariantId ?? "").trim();
    if (!supplierVariantId) {
      return NextResponse.json({ ok: false, error: "Missing supplierVariantId" }, { status: 400 });
    }

    const mapping = await prisma.variantMapping.findUnique({
      where: { supplierVariantId },
      include: { kickdbVariant: { include: { product: true } } },
    });
    if (!mapping) {
      return NextResponse.json({ ok: false, error: "Mapping not found" }, { status: 404 });
    }

    const mappingUpdate = pickFields<Record<string, unknown>>(body.mapping, MAPPING_FIELDS);
    if ("confidenceScore" in mappingUpdate) {
      const score = mappingUpdate.confidenceScore as unknown;
      mappingUpdate.confidenceScore =
        score === null || score === undefined || score === ""
          ? null
          : new Prisma.Decimal(Number.parseFloat(String(score)).toFixed(2));
    }
    if ("providerKey" in mappingUpdate) {
      const value = mappingUpdate.providerKey as unknown;
      mappingUpdate.providerKey = value ? String(value) : null;
    }
    if ("gtin" in mappingUpdate) {
      const value = mappingUpdate.gtin as unknown;
      mappingUpdate.gtin = value ? String(value) : null;
    }
    if ("status" in mappingUpdate) {
      const value = mappingUpdate.status as unknown;
      mappingUpdate.status = value ? String(value) : null;
    }

    const kickdbVariantUpdate = pickFields<Record<string, unknown>>(
      body.kickdbVariant,
      KICKDB_VARIANT_FIELDS
    );
    if ("lastFetchedAt" in kickdbVariantUpdate) {
      kickdbVariantUpdate.lastFetchedAt = parseDate(kickdbVariantUpdate.lastFetchedAt);
    }
    if ("notFound" in kickdbVariantUpdate) {
      kickdbVariantUpdate.notFound = Boolean(kickdbVariantUpdate.notFound);
    }
    for (const key of ["sizeUs", "sizeEu", "gtin", "ean", "providerKey"]) {
      if (key in kickdbVariantUpdate) {
        const value = kickdbVariantUpdate[key];
        kickdbVariantUpdate[key] = value ? String(value) : null;
      }
    }

    const kickdbProductUpdate = pickFields<Record<string, unknown>>(
      body.kickdbProduct,
      KICKDB_PRODUCT_FIELDS
    );
    if ("releaseDate" in kickdbProductUpdate) {
      kickdbProductUpdate.releaseDate = parseDate(kickdbProductUpdate.releaseDate);
    }
    if ("retailPrice" in kickdbProductUpdate) {
      kickdbProductUpdate.retailPrice = toDecimalOrNull(kickdbProductUpdate.retailPrice);
    }
    if ("lastFetchedAt" in kickdbProductUpdate) {
      kickdbProductUpdate.lastFetchedAt = parseDate(kickdbProductUpdate.lastFetchedAt);
    }
    if ("notFound" in kickdbProductUpdate) {
      kickdbProductUpdate.notFound = Boolean(kickdbProductUpdate.notFound);
    }
    for (const key of [
      "urlKey",
      "styleId",
      "name",
      "brand",
      "imageUrl",
      "traitsJson",
      "description",
      "gender",
      "colorway",
      "countryOfManufacture",
    ]) {
      if (key in kickdbProductUpdate) {
        const value = kickdbProductUpdate[key];
        kickdbProductUpdate[key] = value === "" ? null : value;
      }
    }

    const updates = [];
    if (Object.keys(mappingUpdate).length > 0) {
      updates.push(
        prisma.variantMapping.update({
          where: { supplierVariantId },
          data: mappingUpdate,
        })
      );
    }
    if (Object.keys(kickdbVariantUpdate).length > 0 && mapping.kickdbVariantId) {
      updates.push(
        prisma.kickDBVariant.update({
          where: { id: mapping.kickdbVariantId },
          data: kickdbVariantUpdate,
        })
      );
    }
    if (
      Object.keys(kickdbProductUpdate).length > 0 &&
      mapping.kickdbVariant?.productId
    ) {
      updates.push(
        prisma.kickDBProduct.update({
          where: { id: mapping.kickdbVariant.productId },
          data: kickdbProductUpdate,
        })
      );
    }

    if (updates.length === 0) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    await prisma.$transaction(updates);

    const refreshed = await prisma.variantMapping.findUnique({
      where: { supplierVariantId },
      include: { kickdbVariant: { include: { product: true } } },
    });

    return NextResponse.json({
      ok: true,
      mapping: refreshed ?? null,
      kickdbVariant: refreshed?.kickdbVariant ?? null,
      kickdbProduct: refreshed?.kickdbVariant?.product ?? null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Update failed" },
      { status: 500 }
    );
  }
}
