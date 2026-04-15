import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toCsv } from "@/galaxus/exports/csv";
import { accumulateBestCandidates, filterExportCandidates } from "@/galaxus/exports/gtinSelection";
import {
  buildGalaxusAlternativeStockRows,
  filterAlternativeProducts,
  loadAlternativeProductsForExport,
} from "@/galaxus/exports/alternative";
import {
  buildFeedMappingsWhere,
  createTrmFeedExclusionStats,
  recordTrmFeedExclusion,
  totalTrmFeedExclusions,
  trmFeedExclusionsHeaderValue,
} from "@/galaxus/exports/trmExport";
import { PARTNER_KEY_SELECT, partnerKeysLowerSet } from "@/galaxus/exports/partnerPricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = Record<string, string>;

function decimalToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return String(value);
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number) {
  const result = new Date(base);
  result.setDate(result.getDate() + days);
  return result;
}

function businessDaysBetween(start: Date, end: Date): number {
  const startDate = new Date(start);
  const endDate = new Date(end);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);
  if (endDate <= startDate) return 0;
  let count = 0;
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(0, count - 1);
}

function publishStxStockFromAsks(asks: number): number {
  if (!Number.isFinite(asks) || asks < 2) return 0;
  if (asks <= 5) return 2;
  if (asks <= 10) return 5;
  if (asks <= 20) return 8;
  return 12;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 1000);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const supplier = searchParams.get("supplier")?.trim();
  const providerKeys = (searchParams.get("providerKeys") ?? "")
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const mappingsWhere = buildFeedMappingsWhere(supplier, all);
  const providerKeyFilter = providerKeys.length > 0 ? { providerKey: { in: providerKeys } } : null;

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
  const skippedProviderKeys: string[] = [];
  const trmExclusionStats = createTrmFeedExclusionStats();
  const bestByGtin = new Map<string, any>();
  const pageSize = all ? 500 : limit;
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;
  let cursorUpdatedAt: Date | null = null;
  let cursorId: string | null = null;
  const prismaAny = prisma as any;
  const partners = prismaAny.partner?.findMany
    ? await prismaAny.partner.findMany({ select: PARTNER_KEY_SELECT })
    : [];
  const galaxusPartnerKeysLower = partnerKeysLowerSet(partners);

  do {
    const whereClause: Record<string, unknown> = all
      ? {
          ...mappingsWhere,
          ...(providerKeyFilter ? providerKeyFilter : {}),
          ...(cursorUpdatedAt && cursorId
            ? {
                OR: [
                  { updatedAt: { lt: cursorUpdatedAt } },
                  { updatedAt: cursorUpdatedAt, id: { lt: cursorId } },
                ],
              }
            : {}),
        }
      : {
          ...mappingsWhere,
          ...(providerKeyFilter ? providerKeyFilter : {}),
        };
    const mappings: any[] = await prismaAny.variantMapping.findMany({
      where: whereClause,
      select: {
        id: true,
        gtin: true,
        updatedAt: true,
        supplierVariantId: true,
        supplierVariant: {
          select: {
            supplierVariantId: true,
            price: true,
            stock: true,
            manualPrice: true,
            manualStock: true,
            manualLock: true,
            leadTimeDays: true,
            updatedAt: true,
            deliveryType: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: pageSize,
      ...(all ? {} : { skip: currentOffset }),
    });
    lastBatch = mappings.length;
    if (mappings.length > 0) {
      const last: any = mappings[mappings.length - 1];
      cursorUpdatedAt = last.updatedAt ?? null;
      cursorId = last.id ?? null;
    }
    accumulateBestCandidates(mappings, bestByGtin, {
      keyBy: "gtin",
      requireProductName: false,
      // Stock feed should not depend on hosted images.
      requireImage: false,
      galaxusPartnerKeysLower,
      onExclude: (payload) => {
        if (payload.supplierKey === "trm") {
          recordTrmFeedExclusion(trmExclusionStats, payload.reason);
        }
      },
    });
    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const candidates = Array.from(bestByGtin.values()).filter((candidate: any) => {
    const key = String(candidate?.providerKey ?? "");
    return Boolean(key);
  });
  const seenProviderKeys = new Set<string>();
  const uniqueCandidates = candidates.filter((candidate: any) => {
    const key = String(candidate?.providerKey ?? "");
    if (seenProviderKeys.has(key)) return false;
    seenProviderKeys.add(key);
    return true;
  });
  const { valid: exportCandidates, invalidSupplierVariantIds } = filterExportCandidates(uniqueCandidates);
  if (invalidSupplierVariantIds.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "ProviderKey/GTIN invariant failed",
        supplierVariantIds: invalidSupplierVariantIds.slice(0, 50),
      },
      { status: 409 }
    );
  }

  const stxGtins = Array.from(
    new Set(
      exportCandidates
        .filter((candidate: any) => String(candidate?.providerKey ?? "").startsWith("STX_"))
        .map((candidate: any) => String(candidate?.mapping?.gtin ?? "").trim())
        .filter((value: string) => value.length > 0)
    )
  );
  const stxEtaByGtin = new Map<string, { min: Date; max: Date }>();
  if (stxGtins.length > 0) {
    const chunkSize = 500;
    const batches: string[][] = [];
    for (let idx = 0; idx < stxGtins.length; idx += chunkSize) {
      batches.push(stxGtins.slice(idx, idx + chunkSize));
    }
    let supportsCancelledAt = true;
    const rows: Array<{ gtin: string; etaMin: Date; etaMax: Date }> = [];
    for (const batch of batches) {
      try {
        const batchRows = await (prismaAny as any).stxPurchaseUnit.findMany({
          where: supportsCancelledAt
            ? {
                gtin: { in: batch },
                cancelledAt: null,
                stockxOrderId: { not: null },
                etaMin: { not: null },
                etaMax: { not: null },
              }
            : {
                gtin: { in: batch },
                stockxOrderId: { not: null },
                etaMin: { not: null },
                etaMax: { not: null },
              },
          select: { gtin: true, etaMin: true, etaMax: true },
        });
        rows.push(...batchRows);
      } catch (error: any) {
        const message = String(error?.message ?? "");
        if (supportsCancelledAt && message.includes("Unknown argument `cancelledAt`")) {
          supportsCancelledAt = false;
          const batchRows = await (prismaAny as any).stxPurchaseUnit
            .findMany({
              where: {
                gtin: { in: batch },
                stockxOrderId: { not: null },
                etaMin: { not: null },
                etaMax: { not: null },
              },
              select: { gtin: true, etaMin: true, etaMax: true },
            })
            .catch(() => []);
          rows.push(...batchRows);
          continue;
        }
        throw error;
      }
    }
    for (const row of rows) {
      const gtin = String(row?.gtin ?? "").trim();
      if (!gtin || !row?.etaMin || !row?.etaMax) continue;
      const min = new Date(row.etaMin);
      const max = new Date(row.etaMax);
      if (!stxEtaByGtin.has(gtin)) {
        stxEtaByGtin.set(gtin, { min, max });
        continue;
      }
      const current = stxEtaByGtin.get(gtin)!;
      if (min.getTime() < current.min.getTime()) current.min = min;
      if (max.getTime() > current.max.getTime()) current.max = max;
    }
  }

  exportCandidates.forEach((candidate) => {
    const variant = candidate.variant as any;
    const providerKey = candidate.providerKey ?? "";
    if (!providerKey) return;
    const sellPrice = Number(candidate.sellPriceExVat);
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
      if (providerKey) skippedProviderKeys.push(providerKey);
      return;
    }
    const manualLock = Boolean(variant?.manualLock);
    const manualStockRaw = variant?.manualStock;
    const manualStock =
      manualStockRaw === null || manualStockRaw === undefined ? null : Number.parseInt(String(manualStockRaw), 10);
    const baseStock = Number.parseInt(String(variant?.stock ?? 0), 10);
    const rawStock = manualLock && manualStock !== null ? manualStock : baseStock;
    const supplierVariantId = String(variant?.supplierVariantId ?? "");
    const isStx = supplierVariantId.startsWith("stx_") || providerKey.startsWith("STX_");
    const deliveryType = String(variant?.deliveryType ?? "");
    const stock = isStx && deliveryType.startsWith("express_")
      ? publishStxStockFromAsks(rawStock)
      : isStx
        ? 0
        : rawStock;

    if (!Number.isFinite(stock) || stock <= 0) {
      return;
    }

    let restockDate = "";
    let restockTime = "";
    const gtin = String(candidate?.mapping?.gtin ?? "").trim();
    if (isStx && gtin && stxEtaByGtin.has(gtin)) {
      const range = stxEtaByGtin.get(gtin)!;
      const minPlusOne = addDays(range.min, 1);
      const maxPlusOne = addDays(range.max, 1);
      restockDate = toIsoDate(maxPlusOne);
      restockTime = businessDaysBetween(new Date(), minPlusOne).toString();
    } else {
      // Fallback: per-variant lead time (calendar days) when no STX order ETA row exists.
      const leadRaw = variant?.leadTimeDays;
      const leadParsed =
        leadRaw === null || leadRaw === undefined ? NaN : Number.parseInt(String(leadRaw), 10);
      if (Number.isFinite(leadParsed) && leadParsed >= 0) {
        restockTime = String(leadParsed);
        restockDate = toIsoDate(addDays(new Date(), leadParsed));
      }
    }

    rows.push({
      ProviderKey: providerKey,
      QuantityOnStock: Number.isFinite(stock) ? stock.toString() : "0",
      RestockTime: restockTime,
      RestockDate: restockDate,
      MinimumOrderQuantity: "1",
      OrderQuantitySteps: "1",
      TradeUnit: "",
      LogisticUnit: "",
      WarehouseCountry: isStx ? "Switzerland" : "Poland",
      DirectDeliverySupported: isStx ? "yes" : "no",
    });
  });
    let finalRows = rows;
    const allowAlternatives = !supplier || supplier.toLowerCase() === "ner";
    if (allowAlternatives) {
      const normalByGtin = new Map<string, number>();
      const normalByProviderKey = new Map<string, number>();
      for (const candidate of exportCandidates) {
        const gtin = String(candidate?.gtin ?? "").trim();
        const providerKey = String(candidate?.providerKey ?? "").trim();
        const price = Number(candidate?.sellPriceExVat);
        if (gtin && Number.isFinite(price)) normalByGtin.set(gtin, price);
        if (providerKey && Number.isFinite(price)) normalByProviderKey.set(providerKey, price);
      }
      const alternatives = await loadAlternativeProductsForExport({
        providerKeys: providerKeys.length > 0 ? providerKeys : undefined,
      });
      const { exportable } = filterAlternativeProducts({
        alternatives,
        normalByGtin,
        normalByProviderKey,
      });
      const altRows = buildGalaxusAlternativeStockRows(exportable);
      finalRows = [...rows, ...altRows];
      if (finalRows.length < rows.length) {
        return NextResponse.json(
          { ok: false, error: "Alternative merge would shrink export rows." },
          { status: 409 }
        );
      }
    }

    const csv = toCsv(headers, finalRows);
    const filename = `galaxus-stock-${supplier ?? "all"}-${Date.now()}.csv`;
    const trmExcluded = totalTrmFeedExclusions(trmExclusionStats);
    if (trmExcluded > 0) {
      console.info("[GALAXUS][EXPORT][STOCK][TRM] Excluded rows", trmExclusionStats);
    }
    if (skippedProviderKeys.length > 0) {
      console.info("[GALAXUS][EXPORT][STOCK] Skipped invalid price", {
        count: skippedProviderKeys.length,
        providerKeys: Array.from(new Set(skippedProviderKeys)),
      });
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Total-Rows": finalRows.length.toString(),
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
