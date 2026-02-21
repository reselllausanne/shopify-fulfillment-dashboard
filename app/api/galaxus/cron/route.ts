import { NextResponse } from "next/server";
import { runJob } from "@/galaxus/jobs/jobRunner";
import { runCatalogSync } from "@/galaxus/jobs/catalogSync";
import { runStockSync } from "@/galaxus/jobs/stockSync";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { pollIncomingEdi, sendPendingOutgoingEdi } from "@/galaxus/edi/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorize(searchParams: URLSearchParams) {
  return true;
}

export async function GET(request: Request) {
  if (!authorize(new URL(request.url).searchParams)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const task = (searchParams.get("task") ?? "stock").toLowerCase();
    const limit = Number(searchParams.get("limit") ?? "500");
    const offset = Number(searchParams.get("offset") ?? "0");

    const results: Record<string, unknown> = {};

    if (task === "catalog" || task === "all") {
      results.catalog = await runJob("catalog-sync", () => runCatalogSync({ limit, offset }));
    }

    if (task === "stock" || task === "all") {
      results.stock = await runJob("stock-sync", () => runStockSync({ limit, offset }));
    }

    if (task === "kickdb" || task === "all") {
      results.kickdb = await runJob("kickdb-enrich", () => runKickdbEnrich({ limit, offset }));
    }

    if (task === "edi-in" || task === "all") {
      results.ediIn = await runJob("edi-in", () => pollIncomingEdi());
    }

    if (task === "edi-out" || task === "all") {
      results.ediOut = await runJob("edi-out", () => sendPendingOutgoingEdi(5));
    }

    if (task === "feeds-master" || task === "all") {
      const origin = new URL(request.url).origin;
      const supplier = searchParams.get("supplier")?.trim();
      const supplierParam = supplier ? `&supplier=${encodeURIComponent(supplier)}` : "";
      results.feedsMaster = await runJob("feeds-master", async () => {
        const supplierRes = await fetch(`${origin}/api/galaxus/supplier/sync?all=1`, {
          cache: "no-store",
        });
        const supplierData = await supplierRes.json().catch(() => ({}));
        if (!supplierRes.ok || !supplierData.ok) {
          throw new Error(supplierData?.error ?? "Supplier sync failed");
        }
        const partnerRes = await fetch(`${origin}/api/galaxus/partners/sync?all=1`, {
          cache: "no-store",
        });
        const partnerData = await partnerRes.json().catch(() => ({}));
        if (!partnerRes.ok || !partnerData.ok) {
          throw new Error(partnerData?.error ?? "Partner sync failed");
        }
        const res = await fetch(`${origin}/api/galaxus/feeds/upload?type=master${supplierParam}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data?.error ?? "Feed master upload failed");
        }
        return { supplier: supplierData, partner: partnerData, upload: data };
      });
    }

    if (task === "feeds-offer-stock" || task === "all") {
      const origin = new URL(request.url).origin;
      const supplier = searchParams.get("supplier")?.trim();
      const supplierParam = supplier ? `&supplier=${encodeURIComponent(supplier)}` : "";
      results.feedsOfferStock = await runJob("feeds-offer-stock", async () => {
        const supplierRes = await fetch(`${origin}/api/galaxus/supplier/sync?all=1`, {
          cache: "no-store",
        });
        const supplierData = await supplierRes.json().catch(() => ({}));
        if (!supplierRes.ok || !supplierData.ok) {
          throw new Error(supplierData?.error ?? "Supplier sync failed");
        }
        const partnerRes = await fetch(`${origin}/api/galaxus/partners/sync?all=1`, {
          cache: "no-store",
        });
        const partnerData = await partnerRes.json().catch(() => ({}));
        if (!partnerRes.ok || !partnerData.ok) {
          throw new Error(partnerData?.error ?? "Partner sync failed");
        }
        const res = await fetch(`${origin}/api/galaxus/feeds/upload?type=offer-stock${supplierParam}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data?.error ?? "Feed offer/stock upload failed");
        }
        return { supplier: supplierData, partner: partnerData, upload: data };
      });
    }

    return NextResponse.json({ ok: true, task, limit, offset, results });
  } catch (error: any) {
    console.error("[GALAXUS][CRON] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
