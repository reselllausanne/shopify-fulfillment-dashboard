import { NextResponse } from "next/server";
import { runOpsTick } from "@/galaxus/ops/tick";
import { runFeedPipeline } from "@/galaxus/ops/feedPipeline";
import { GALAXUS_FEED_UPLOADS_DISABLED } from "@/galaxus/config";
import { syncShopifyCatalog } from "@/shopify/catalog/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      stxMode?: string;
      partnerKey?: string;
    };
    const action = String(body?.action ?? "").trim().toLowerCase();
    const partnerKey = String(body?.partnerKey ?? "").trim();

    if (!action) {
      return NextResponse.json({ ok: false, error: "Missing action" }, { status: 400 });
    }

    if (action === "tick") {
      const data = await runOpsTick(origin, { force: true });
      return NextResponse.json({ ok: true, data });
    }

    if (action === "partner-sync") {
      const partnerScope = partnerKey || "THE";
      const data = await runOpsTick(origin, {
        force: true,
        only: ["partner-stock-sync"],
        partnerKey: partnerScope,
      });
      const shopifyCatalog = await syncShopifyCatalog({
        limit: 5000,
        supplierKey: partnerScope.toLowerCase(),
        inStockOnly: true,
        missingOnly: false,
        dryRun: false,
      });
      return NextResponse.json({ ok: true, partnerKey: partnerScope, data, shopifyCatalog });
    }

    if (action === "stx-refresh") {
      const stxMode = String(body?.stxMode ?? "price").toLowerCase() === "full" ? "full" : "price";
      const data = await runOpsTick(origin, {
        force: true,
        only: ["stx-refresh"],
        stxRefreshMode: stxMode,
      });
      return NextResponse.json({ ok: true, data, stxMode });
    }

    if (action === "edi-in") {
      const data = await runOpsTick(origin, { force: true, only: ["edi-in"] });
      return NextResponse.json({ ok: true, data });
    }
    if (action === "image-sync") {
      const data = await runOpsTick(origin, { force: true, only: ["image-sync"] });
      return NextResponse.json({ ok: true, data });
    }

    if (action.startsWith("push-") && GALAXUS_FEED_UPLOADS_DISABLED) {
      return NextResponse.json(
        { ok: false, error: "Feed uploads are disabled" },
        { status: 403 }
      );
    }

    if (action === "push-stock-price") {
      const res = await runFeedPipeline({ origin, scope: "stock-price", triggerSource: "manual" });
      return NextResponse.json({ ok: res.ok, result: res });
    }
    if (action === "push-stock") {
      const res = await runFeedPipeline({ origin, scope: "stock", triggerSource: "manual" });
      return NextResponse.json({ ok: res.ok, result: res });
    }
    if (action === "push-price") {
      const res = await runFeedPipeline({ origin, scope: "price", triggerSource: "manual" });
      return NextResponse.json({ ok: res.ok, result: res });
    }

    if (action === "push-full") {
      const res = await runFeedPipeline({ origin, scope: "full", triggerSource: "manual" });
      return NextResponse.json({ ok: res.ok, result: res });
    }
    if (action === "push-master-specs") {
      const res = await runFeedPipeline({ origin, scope: "master-specs", triggerSource: "manual" });
      return NextResponse.json({ ok: res.ok, result: res });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("[GALAXUS][OPS][RUN] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Run failed" },
      { status: 500 }
    );
  }
}
