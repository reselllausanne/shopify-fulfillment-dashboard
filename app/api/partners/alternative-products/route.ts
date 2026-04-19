import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { isAlternativeProductsPartnerKey } from "@/app/lib/alternativeProducts";
import { loadNormalExportCandidatePrices } from "@/galaxus/exports/alternative";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AlternativeProductListItem = {
  id: string;
  uploadId: string | null;
  externalKey: string;
  gtin: string;
  providerKey: string;
  brand: string;
  title: string;
  variantName: string | null;
  description: string;
  category: string;
  size: string;
  mainImageUrl: string;
  extraImageUrls: unknown;
  color: string | null;
  gender: string | null;
  material: string | null;
  stock: number;
  priceExVat: number | null;
  vatRate: number | null;
  currency: string;
  leadTimeDays: number | null;
  specsJson: unknown;
  decathlonLogisticClass: string | null;
  decathlonLeadTimeToShip: number | null;
  exportEnabled: boolean;
  status: string;
  validationErrorsJson: unknown;
  archivedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

function parseDecimal(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAlternativeProductsPartnerKey(session.partnerKey)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "200"), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const includeArchived = ["1", "true", "yes"].includes(
    (searchParams.get("includeArchived") ?? "").toLowerCase()
  );
  const includeConflicts = !["0", "false", "no"].includes(
    (searchParams.get("includeConflicts") ?? "1").toLowerCase()
  );

  const prismaAny = prisma as any;
  const rows = await prismaAny.alternativeProduct.findMany({
    where: {
      partnerId: session.partnerId,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const items: AlternativeProductListItem[] = rows.map((row: any) => ({
    id: row.id,
    uploadId: row.uploadId ?? null,
    externalKey: row.externalKey ?? "",
    gtin: row.gtin ?? "",
    providerKey: row.providerKey ?? "",
    brand: row.brand ?? "",
    title: row.title ?? "",
    variantName: row.variantName ?? null,
    description: row.description ?? "",
    category: row.category ?? "",
    size: row.size ?? "",
    mainImageUrl: row.mainImageUrl ?? "",
    extraImageUrls: row.extraImageUrls ?? [],
    color: row.color ?? null,
    gender: row.gender ?? null,
    material: row.material ?? null,
    stock: row.stock ?? 0,
    priceExVat: parseDecimal(row.priceExVat),
    vatRate: parseDecimal(row.vatRate),
    currency: row.currency ?? "CHF",
    leadTimeDays: row.leadTimeDays ?? null,
    specsJson: row.specsJson ?? null,
    decathlonLogisticClass: row.decathlonLogisticClass ?? null,
    decathlonLeadTimeToShip: row.decathlonLeadTimeToShip ?? null,
    exportEnabled: Boolean(row.exportEnabled),
    status: row.status ?? "",
    validationErrorsJson: row.validationErrorsJson ?? null,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  }));

  let conflictByKey = new Map<string, { reason: string; normalPrice: number }>();
  if (includeConflicts && items.length > 0) {
    const gtins = items.map((item) => item.gtin).filter(Boolean);
    const providerKeys = items.map((item) => item.providerKey).filter(Boolean);
    const { byGtin, byProviderKey } = await loadNormalExportCandidatePrices({ gtins, providerKeys });
    for (const item of items) {
      const providerMatch = byProviderKey.get(item.providerKey);
      if (providerMatch !== undefined) {
        conflictByKey.set(item.id, { reason: "MATCHING_PROVIDER_KEY", normalPrice: providerMatch });
        continue;
      }
      const gtinMatch = byGtin.get(item.gtin);
      if (gtinMatch !== undefined) {
        const priceValue = typeof item.priceExVat === "number" ? item.priceExVat : NaN;
        if (Number.isFinite(priceValue) && priceValue > gtinMatch) {
          conflictByKey.set(item.id, { reason: "PRICE_HIGHER", normalPrice: gtinMatch });
        } else {
          conflictByKey.set(item.id, { reason: "DUPLICATE_GTIN", normalPrice: gtinMatch });
        }
      }
    }
  }

  const enriched = items.map((item) => {
    const conflict = conflictByKey.get(item.id) ?? null;
    const exportable = Boolean(item.exportEnabled) && !item.archivedAt && !conflict;
    return {
      ...item,
      exportConflict: conflict,
      exportable,
    };
  });

  return NextResponse.json({
    ok: true,
    items: enriched,
    nextOffset: items.length === limit ? offset + limit : null,
  });
}
