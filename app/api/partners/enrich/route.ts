import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { buildSupplierVariantId } from "@/app/lib/partnerImport";
import { validateGtin } from "@/app/lib/normalize";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { assertMappingIntegrity, buildProviderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const prismaAny = prisma as any;
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get("mode") ?? "new").toLowerCase();
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const debug = searchParams.get("debug") === "1";
    const force = searchParams.get("force") === "1";
    const limit = Math.min(Number(searchParams.get("limit") ?? "500"), 2000);

    const partnerKey = normalizeProviderKey(session.partnerKey);
    if (!partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }

    const pendingRows = await prismaAny.partnerUploadRow.findMany({
      where: {
        providerKey: partnerKey,
        status: "PENDING_ENRICH",
      },
      orderBy: { updatedAt: "desc" },
      take: all ? undefined : limit,
    });

    if (!pendingRows.length) {
      return NextResponse.json({ ok: true, mode, processed: 0, results: [] });
    }

    const results: Array<Record<string, unknown>> = [];
    let processed = 0;
    let resolvedCount = 0;
    const now = new Date();

    for (const row of pendingRows) {
      const providerKeyValue = normalizeProviderKey(row.providerKey) ?? partnerKey;
      const sku = String(row.sku ?? "").trim();
      const sizeNormalized = String(row.sizeNormalized ?? row.sizeRaw ?? "").trim();
      if (!sku || !sizeNormalized) {
        await prismaAny.partnerUploadRow.update({
          where: { id: row.id },
          data: {
            status: "PENDING_GTIN",
            errorsJson: [{ message: "Invalid SKU or size" }],
            updatedAt: now,
          },
        });
        continue;
      }
      const supplierVariantId =
        String(row.supplierVariantId ?? "").trim() ||
        buildSupplierVariantId(providerKeyValue, sku, sizeNormalized);

      let resolvedGtin: string | null = null;
      let gtinCandidates: string[] = [];
      let isAmbiguous = false;

      const existingVariant = await prismaAny.supplierVariant.findUnique({
        where: { supplierVariantId },
        select: { gtin: true, providerKey: true },
      });
      if (existingVariant?.gtin && validateGtin(existingVariant.gtin) && !force) {
        resolvedGtin = existingVariant.gtin;
      } else {
        try {
          const enrich = await runKickdbEnrich({ supplierVariantId, force });
          const match = enrich?.results?.find((result: any) => result.supplierVariantId === supplierVariantId);
          const mapping = await prismaAny.variantMapping.findUnique({
            where: { supplierVariantId },
            select: { gtin: true },
          });
          gtinCandidates = match?.gtinCandidates ?? [];
          isAmbiguous = match?.status === "AMBIGUOUS_GTIN" || gtinCandidates.length > 1;
          resolvedGtin = match?.gtin ?? mapping?.gtin ?? null;
        } catch (err: any) {
          const message = err?.message ?? "Enrichment failed";
          await prismaAny.partnerUploadRow.update({
            where: { id: row.id },
            data: {
              status: "PENDING_GTIN",
              errorsJson: [{ message }],
              updatedAt: now,
            },
          });
          if (debug) {
            results.push({ rowId: row.id, status: "ERROR", error: message });
          }
          continue;
        }
      }

      if (isAmbiguous) {
        await prismaAny.partnerUploadRow.update({
          where: { id: row.id },
          data: {
            status: "AMBIGUOUS_GTIN",
            gtinResolved: null,
            gtinCandidatesJson: gtinCandidates,
            updatedAt: now,
          },
        });
        if (debug) {
          results.push({
            rowId: row.id,
            supplierVariantId,
            status: "AMBIGUOUS_GTIN",
            gtinCandidates,
          });
        }
        processed += 1;
        continue;
      }

      if (!resolvedGtin || !validateGtin(resolvedGtin)) {
        await prismaAny.partnerUploadRow.update({
          where: { id: row.id },
          data: {
            status: "PENDING_GTIN",
            gtinResolved: null,
            errorsJson: [{ message: "GTIN not resolved" }],
            updatedAt: now,
          },
        });
        if (debug) {
          results.push({ rowId: row.id, supplierVariantId, status: "PENDING_GTIN" });
        }
        processed += 1;
        continue;
      }

      const fullProviderKey = buildProviderKey(resolvedGtin, supplierVariantId);
      if (!fullProviderKey) {
        await prismaAny.partnerUploadRow.update({
          where: { id: row.id },
          data: {
            status: "PENDING_GTIN",
            gtinResolved: null,
            errorsJson: [{ message: "Invalid GTIN" }],
            updatedAt: now,
          },
        });
        if (debug) {
          results.push({ rowId: row.id, supplierVariantId, status: "ERROR", error: "Invalid GTIN" });
        }
        processed += 1;
        continue;
      }

      assertMappingIntegrity({
        supplierVariantId,
        gtin: resolvedGtin,
        providerKey: fullProviderKey,
        status: "MATCHED",
      });

      let offer = await prismaAny.supplierVariant.findUnique({
        where: { providerKey_gtin: { providerKey: fullProviderKey, gtin: resolvedGtin } },
      });

      if (offer) {
        offer = await prismaAny.supplierVariant.update({
          where: { supplierVariantId: offer.supplierVariantId },
          data: {
            supplierSku: sku,
            providerKey: fullProviderKey,
            gtin: resolvedGtin,
            sizeRaw: row.sizeRaw,
            sizeNormalized: row.sizeNormalized,
            stock: row.rawStock,
            price: row.price,
            lastSyncAt: now,
          },
        });
      } else {
        offer = await prismaAny.supplierVariant.upsert({
          where: { supplierVariantId },
          create: {
            supplierVariantId,
            supplierSku: sku,
            providerKey: fullProviderKey,
            gtin: resolvedGtin,
            sizeRaw: row.sizeRaw,
            sizeNormalized: row.sizeNormalized,
            stock: row.rawStock,
            price: row.price,
            lastSyncAt: now,
          },
          update: {
            supplierSku: sku,
            providerKey: fullProviderKey,
            gtin: resolvedGtin,
            sizeRaw: row.sizeRaw,
            sizeNormalized: row.sizeNormalized,
            stock: row.rawStock,
            price: row.price,
            lastSyncAt: now,
          },
        });
      }

      if (offer.supplierVariantId !== supplierVariantId) {
        const existingMapping = await prismaAny.variantMapping.findUnique({
          where: { supplierVariantId: offer.supplierVariantId },
          select: { supplierVariantId: true },
        });
        if (existingMapping) {
          await prismaAny.variantMapping.deleteMany({
            where: { supplierVariantId },
          });
        } else {
          await prismaAny.variantMapping.updateMany({
            where: { supplierVariantId },
            data: { supplierVariantId: offer.supplierVariantId },
          });
        }
        await prismaAny.supplierVariant.deleteMany({
          where: { supplierVariantId },
        });
      }

      await prismaAny.variantMapping.upsert({
        where: { supplierVariantId: offer.supplierVariantId },
        create: {
          supplierVariantId: offer.supplierVariantId,
          gtin: resolvedGtin,
          providerKey: fullProviderKey,
          status: "MATCHED",
        },
        update: {
          gtin: resolvedGtin,
          providerKey: fullProviderKey,
          status: "MATCHED",
        },
      });

      await prismaAny.partnerUploadRow.update({
        where: { id: row.id },
        data: {
          status: "RESOLVED",
          gtinResolved: resolvedGtin,
          updatedAt: now,
        },
      });

      resolvedCount += 1;
      processed += 1;

      if (debug) {
        results.push({ rowId: row.id, supplierVariantId, status: "RESOLVED", gtin: resolvedGtin });
      }
    }

    if (resolvedCount > 0) {
      const origin = new URL(request.url).origin;
      await requestFeedPush({ origin, scope: "full", triggerSource: "partner-admin", runNow: true });
    }

    return NextResponse.json({
      ok: true,
      mode,
      processed,
      resolved: resolvedCount,
      results,
    });
  } catch (error: any) {
    console.error("[PARTNER][KICKDB][ENRICH] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
