import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { dryRunPlan, getBuyLagDays } from "@/lib/stockxAutoCheckout/queue";
import { runStockxAutoEasyAndEmailRest } from "@/lib/stockxAutoCheckout/runAutoBatch";
import {
  runShopifyBatchBuy,
  SHOPIFY_STANDARD_BATCH_13,
  type ShopifyBatchBuyItem,
} from "@/lib/stockxAutoCheckout/shopifyBatchBuy";
import {
  confirmStockxCheckout,
  getStockxCheckoutState,
  previewStockxCheckout,
  runStockxAutoCheckoutForOrder,
} from "@/lib/stockxCheckout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Batch buy can run many sequential PDPs on one sticky session. */
export const maxDuration = 900;

async function requireAdmin(req: NextRequest) {
  const role = await getStaffRoleFromRequest(req);
  return role === "admin";
}

function serializeQueuePlan(plan: Awaited<ReturnType<typeof dryRunPlan>>) {
  return {
    timezone: plan.timezone,
    lagDays: plan.lagDays,
    monthKey: plan.monthKey,
    todayKey: plan.todayKey,
    cutoffSellDateKey: plan.cutoffSellDateKey,
    oldestUnlinkedSellDateKey: plan.oldestUnlinkedSellDateKey,
    oldestUnlinkedOrderName: plan.oldestUnlinkedOrderName,
    unlinkedThisMonthCount: plan.unlinkedThisMonth.length,
    lagEligibleCount: plan.lagEligible.length,
    cohortSellDateKey: plan.cohortSellDateKey,
    cohortCount: plan.cohort.length,
    orderNamesIfRunNow: plan.orderNamesIfRunNow,
    cohort: plan.cohort.map((o) => ({
      orderName: o.orderName,
      sellDateKey: o.sellDateKey,
      createdAt: o.createdAt.toISOString(),
      netSalesChf: o.netSalesChf,
    })),
  };
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const state = await getStockxCheckoutState();
  let queue = null;
  try {
    queue = serializeQueuePlan(await dryRunPlan({ lagDays: getBuyLagDays() }));
  } catch (e: any) {
    console.error("[STOCKX-CHECKOUT] queue plan failed", e?.message || e);
  }
  return NextResponse.json({ ok: true, ...state, queue });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "preview");

  try {
    if (action === "preview") {
      const orderName = String(body.orderName ?? "").trim();
      if (!orderName) {
        return NextResponse.json({ ok: false, error: "Missing orderName" }, { status: 400 });
      }
      const preview = await previewStockxCheckout({
        orderName,
        slug: body.slug ? String(body.slug) : null,
        lineItemId: body.lineItemId ? String(body.lineItemId) : null,
      });
      return NextResponse.json({ ok: true, preview });
    }

    if (action === "confirm") {
      const previewId = String(body.previewId ?? "").trim();
      const confirmTotalChf = Number(body.confirmTotalChf);
      if (!previewId || !Number.isFinite(confirmTotalChf)) {
        return NextResponse.json(
          { ok: false, error: "previewId + confirmTotalChf required" },
          { status: 400 }
        );
      }
      const result = await confirmStockxCheckout({ previewId, confirmTotalChf });
      return NextResponse.json({ ...result }, { status: result.ok ? 200 : 409 });
    }

    if (action === "auto_one") {
      const orderName = String(body.orderName ?? "").trim();
      if (!orderName) {
        return NextResponse.json({ ok: false, error: "Missing orderName" }, { status: 400 });
      }
      const result = await runStockxAutoCheckoutForOrder({
        orderName,
        slug: body.slug ? String(body.slug) : null,
        lineItemId: body.lineItemId ? String(body.lineItemId) : null,
        dryRun: Boolean(body.dryRun),
      });
      return NextResponse.json({ ok: true, result });
    }

    if (action === "queue_plan" || action === "dry_run_plan") {
      const lagDays =
        body.lagDays != null ? Number(body.lagDays) : getBuyLagDays();
      const plan = await dryRunPlan({
        lagDays: Number.isFinite(lagDays) ? lagDays : getBuyLagDays(),
      });
      return NextResponse.json({ ok: true, queue: serializeQueuePlan(plan) });
    }

    if (action === "auto_easy_email_rest") {
      const orderNames = Array.isArray(body.orderNames)
        ? body.orderNames.map((n) => String(n))
        : undefined;
      // dryRun / previewOnly → classify + stop before Place Order (no charge, no ops email).
      const dryRun =
        body.dryRun === true ||
        body.dryRun === "true" ||
        body.previewOnly === true ||
        body.previewOnly === "true";
      const useQueue = body.useQueue !== false && body.useQueue !== "false";
      const summary = await runStockxAutoEasyAndEmailRest({
        days: body.days != null ? Number(body.days) : undefined,
        orderNames,
        dryRun,
        maxOrders: body.maxOrders != null ? Number(body.maxOrders) : undefined,
        useQueue,
        lagDays: body.lagDays != null ? Number(body.lagDays) : undefined,
      });
      return NextResponse.json({
        ok: true,
        summary: {
          ...summary,
          queue: summary.queue ? serializeQueuePlan(summary.queue) : null,
        },
      });
    }

    if (action === "shopify_batch_buy" || action === "shopify-batch-buy") {
      const confirmLive =
        body.confirmLive === true ||
        body.confirmLive === "true" ||
        body.go === true ||
        body.go === "true";
      // Default dry-run unless confirmLive/go — never surprise Place Order.
      const dryRun = !confirmLive;
      let items: ShopifyBatchBuyItem[] = SHOPIFY_STANDARD_BATCH_13;
      if (Array.isArray(body.items) && body.items.length) {
        items = body.items.map((raw) => {
          const r = raw as Record<string, unknown>;
          return {
            orderName: String(r.orderName ?? ""),
            slug: String(r.slug ?? ""),
            sizeEU: String(r.sizeEU ?? ""),
            lineItemId: r.lineItemId != null ? String(r.lineItemId) : null,
          };
        });
      } else if (Array.isArray(body.orderNames) && body.orderNames.length) {
        const want = new Set(body.orderNames.map((n) => String(n).replace(/^#?/, "#")));
        items = SHOPIFY_STANDARD_BATCH_13.filter((i) => want.has(i.orderName));
      }
      const summary = await runShopifyBatchBuy({
        items,
        dryRun,
        confirmLive,
      });
      return NextResponse.json({ ok: true, summary });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("[STOCKX-CHECKOUT]", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Checkout failed" },
      { status: 500 }
    );
  }
}
