import { NextResponse } from "next/server";
import { runJob } from "@/galaxus/jobs/jobRunner";
import { runCatalogSync } from "@/galaxus/jobs/catalogSync";
import { runStockPriceSync, runStockSync } from "@/galaxus/jobs/stockSync";
import { runTrmStockSync, runTrmSync } from "@/galaxus/jobs/trmSync";
import { prisma } from "@/app/lib/prisma";
import { importStxProductByInput } from "@/galaxus/stx/importProduct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const includeTrm = searchParams.get("includeTrm") !== "0";
    const mode = (searchParams.get("mode") ?? "full").toLowerCase();
    const maxParam = searchParams.get("max");
    const max = maxParam ? Math.max(Number(maxParam) || 0, 0) : null;

    const limit = all
      ? undefined
      : max !== null
        ? Math.min(Math.max(max, 1), 10000)
        : Math.min(Number(searchParams.get("limit") ?? "50"), 500);
    const offset = all || max !== null ? 0 : Math.max(Number(searchParams.get("offset") ?? "0"), 0);

    const shouldRunCatalog = mode === "full" || mode === "catalog";
    const shouldRunStock = mode === "full" || mode === "stock";
    const stxLimitRaw = Number(searchParams.get("stxLimit") ?? "100");
    const stxLimit = Math.min(Math.max(Number.isFinite(stxLimitRaw) ? stxLimitRaw : 100, 1), 500);

    let stxImport = null as
      | null
      | {
          processed: number;
          imported: number;
          errored: number;
        };
    if (shouldRunStock) {
      const prismaAny = prisma as any;
      const pending = await prismaAny.stxImportSlug.findMany({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
        take: stxLimit,
      });
      if (pending.length > 0) {
        let imported = 0;
        let errored = 0;
        for (const row of pending) {
          try {
            const result = await importStxProductByInput(String(row.input ?? row.slug));
            if (result.ok) {
              imported += 1;
              await prismaAny.stxImportSlug.update({
                where: { slug: row.slug },
                data: { status: "IMPORTED", importedAt: new Date(), lastError: null },
              });
            } else {
              errored += 1;
              await prismaAny.stxImportSlug.update({
                where: { slug: row.slug },
                data: {
                  status: "ERROR",
                  lastError: result.errors?.[0] ?? "Import failed",
                },
              });
            }
          } catch (error: any) {
            errored += 1;
            await prismaAny.stxImportSlug.update({
              where: { slug: row.slug },
              data: {
                status: "ERROR",
                lastError: error?.message ?? "Import failed",
              },
            });
          }
        }
        stxImport = { processed: pending.length, imported, errored };
      }
    }

    const [catalog, stock, trm] = await Promise.all([
      shouldRunCatalog ? runJob("catalog-sync", () => runCatalogSync({ limit, offset })) : Promise.resolve(null),
      shouldRunStock
        ? runJob(
            "stock-sync",
            () => (mode === "stock" ? runStockPriceSync({ limit, offset }) : runStockSync({ limit, offset }))
          )
        : Promise.resolve(null),
      includeTrm
        ? runJob("trm-sync", () =>
            mode === "stock"
              ? runTrmStockSync({ limit, offset, enrichMissingGtin: false })
              : runTrmSync({
                  limit,
                  offset,
                  enrichMissingGtin: false,
                })
          )
        : Promise.resolve(null),
    ]);
    return NextResponse.json({
      ok: true,
      mode: all ? "all" : "max",
      syncMode: mode,
      limit: limit ?? null,
      offset,
      includeTrm,
      stxImport,
      catalog,
      stock,
      trm,
    });
  } catch (error: any) {
    console.error("[GALAXUS][SUPPLIER][SYNC] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
