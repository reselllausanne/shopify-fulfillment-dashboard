import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { GALAXUS_FEED_INCLUDE_TRM } from "@/galaxus/config";
import { toCsv } from "@/galaxus/exports/csv";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";
import {
  buildFeedMappingsWhere,
  createTrmFeedExclusionStats,
  recordTrmFeedExclusion,
  totalTrmFeedExclusions,
  trmFeedExclusionsHeaderValue,
} from "@/galaxus/exports/trmExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = Record<string, string>;

function decimalToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return String(value);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 1000);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const supplier = searchParams.get("supplier")?.trim();

  const mappingsWhere = buildFeedMappingsWhere(supplier, all);

  const headers = [
    "ProviderKey",
    "QuantityOnStock",
    "RestockTime",
    "RestockDate",
    "MinimumOrderQuantity",
    "OrderQuantitySteps",
    "TradeUnit",
    "LogisticUnit",
    "WarehouseCountry",
    "DirectDeliverySupported",
  ];

  const rows: ExportRow[] = [];
  const trmExclusionStats = createTrmFeedExclusionStats();
  const bestByGtin = new Map<string, any>();
  const pageSize = all ? 500 : limit;
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;
  const prismaAny = prisma as any;
  const partners = prismaAny.partner?.findMany ? await prismaAny.partner.findMany() : [];
  const partnerByKey = new Map<string, any>(
    partners.map((p: any) => [String(p.key ?? "").toLowerCase(), p])
  );
  const toNumber = (value: any) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const resolvePartnerOverrides = (key: string | null) => {
    if (!key) return null;
    const partner = partnerByKey.get(key.toLowerCase());
    if (!partner) return null;
    return {
      targetMargin: toNumber(partner.targetMargin),
      shippingPerPair: toNumber(partner.shippingPerPair),
      bufferPerPair: toNumber(partner.bufferPerPair),
      roundTo: toNumber(partner.roundTo),
      vatRate: toNumber(partner.vatRate),
    };
  };

  do {
    const mappings = await prismaAny.variantMapping.findMany({
      where: {
        ...mappingsWhere,
      },
      include: {
        supplierVariant: true,
        kickdbVariant: { include: { product: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: pageSize,
      skip: currentOffset,
    });
    lastBatch = mappings.length;
    accumulateBestCandidates(mappings, bestByGtin, resolvePartnerOverrides, {
      includeTrm: GALAXUS_FEED_INCLUDE_TRM,
      onExclude: (payload) => {
        if (payload.supplierKey === "trm") {
          recordTrmFeedExclusion(trmExclusionStats, payload.reason);
        }
      },
    });
    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const candidates = Array.from(bestByGtin.values());
  candidates.forEach((candidate) => {
    const variant = candidate.variant as any;
    const providerKey = candidate.providerKey ?? "";
    if (!providerKey) return;
    const stock = Number.parseInt(String(variant?.stock ?? 0), 10);

    rows.push({
      ProviderKey: providerKey,
      QuantityOnStock: Number.isFinite(stock) ? stock.toString() : "0",
      RestockTime: "",
      RestockDate: "",
      MinimumOrderQuantity: "1",
      OrderQuantitySteps: "1",
      TradeUnit: "",
      LogisticUnit: "",
      WarehouseCountry: "Poland",
      DirectDeliverySupported: "no",
    });
  });

    const csv = toCsv(headers, rows);
    const filename = `galaxus-stock-${supplier ?? "all"}-${Date.now()}.csv`;
    const trmExcluded = totalTrmFeedExclusions(trmExclusionStats);
    if (trmExcluded > 0) {
      console.info("[GALAXUS][EXPORT][STOCK][TRM] Excluded rows", trmExclusionStats);
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Total-Rows": rows.length.toString(),
        "X-Offset": offset.toString(),
        "X-TRM-Excluded": trmFeedExclusionsHeaderValue(trmExclusionStats),
      },
    });
  } catch (error: any) {
    console.error("Stock export failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Stock export failed" },
      { status: 500 }
    );
  }
}
