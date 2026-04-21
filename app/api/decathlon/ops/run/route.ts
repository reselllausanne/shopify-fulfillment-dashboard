import { NextResponse } from "next/server";
import {
  runDecathlonProductSync,
  checkLatestImportStatus,
  runDecathlonOfferSync,
  runDecathlonOfferOnlySync,
  runDecathlonPriceSync,
  runDecathlonStockSync,
} from "@/decathlon/mirakl/sync";
import type { MiraklImportMode } from "@/decathlon/mirakl/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();
    const limitRaw = Number.parseInt(body?.limit ?? "", 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
    const offsetRaw = Number.parseInt(body?.offset ?? "", 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    const modeRaw = String(body?.mode ?? "").trim().toUpperCase();
    const mode: MiraklImportMode | undefined = modeRaw === "REPLACE" ? "REPLACE" : modeRaw === "NORMAL" ? "NORMAL" : undefined;

    if (action === "offer-sync") {
      const result = await runDecathlonOfferSync({ limit, includeAll: false, mode: mode ?? "NORMAL" });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "offer-full") {
      const result = await runDecathlonOfferSync({ limit, includeAll: true, mode: mode ?? "NORMAL" });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "offer-only") {
      const result = await runDecathlonOfferOnlySync({ limit, includeAll: false, mode: mode ?? "NORMAL" });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "product-sync") {
      const rawAi = body?.useAiEnrichment ?? body?.ai_enrichment;
      let useAiEnrichment: boolean | undefined;
      if (rawAi === false || rawAi === 0) {
        useAiEnrichment = false;
      } else if (typeof rawAi === "string") {
        const s = rawAi.trim().toLowerCase();
        if (s === "false" || s === "0" || s === "no") useAiEnrichment = false;
        else if (s === "true" || s === "1" || s === "yes") useAiEnrichment = true;
      } else if (rawAi === true || rawAi === 1) {
        useAiEnrichment = true;
      }
      // Omitted / unknown → undefined so runP41Import defaults to Mirakl AI (AI_CONVERTER on).
      const result = await runDecathlonProductSync({ limit, offset, useAiEnrichment });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "stock-sync") {
      const result = await runDecathlonStockSync({ limit });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "price-sync") {
      const result = await runDecathlonPriceSync({ limit });
      return NextResponse.json({ ok: true, result });
    }
    if (action === "status-of01") {
      const result = await checkLatestImportStatus("OF01");
      return NextResponse.json(result);
    }
    if (action === "status-sto01") {
      const result = await checkLatestImportStatus("STO01");
      return NextResponse.json(result);
    }
    if (action === "status-pri01") {
      const result = await checkLatestImportStatus("PRI01");
      return NextResponse.json(result);
    }
    if (action === "status-p41") {
      const result = await checkLatestImportStatus("P41");
      return NextResponse.json(result);
    }
    if (action === "status-all") {
      const [p41, of01, sto01, pri01] = await Promise.all([
        checkLatestImportStatus("P41"),
        checkLatestImportStatus("OF01"),
        checkLatestImportStatus("STO01"),
        checkLatestImportStatus("PRI01"),
      ]);
      return NextResponse.json({ ok: true, results: { p41, of01, sto01, pri01 } });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("[DECATHLON][OPS][RUN] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Run failed" },
      { status: 500 }
    );
  }
}
