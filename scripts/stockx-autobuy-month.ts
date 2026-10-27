/**
 * LIVE monthly StockX auto-buy driver — oldest-first, one reused browser session.
 *
 * Pipeline per run:
 *   1. refreshStockxToken(default + galaxus) once.
 *   2. Re-derive buy set: listUnlinkedStockxNeededThisMonth(now) → per order
 *      loadShopifyLine → detect Express lane → precheckStockxBuyability → slug.
 *      Keep only status==="buyable" && slug && not title-excluded.
 *   3. Prebuy dedupe FIRST (linkIfClear) per order, oldest-first, with transient retry.
 *      Blocked verdicts → SKIPPED_ALREADY (never buy). BUY_OK → buy list.
 *   4. runShopifyBatchBuy LIVE (one session) for the BUY_OK items; retry retryable
 *      fails (proxy_blank / price_moved / CF / timeout) ≤3 passes with backoff.
 *   5. Verify each buy: OrderMatch.stockxOrderNumber + sane supplierCost; enrich when
 *      the cost looks wrong vs expectedBuy (the #7566 cost=44 vs 84.25 bug).
 *
 * Usage:
 *   npx tsx scripts/stockx-autobuy-month.ts            # dry (derive + dedupe only)
 *   npx tsx scripts/stockx-autobuy-month.ts --go       # LIVE buys
 *   npx tsx scripts/stockx-autobuy-month.ts --go --only=7538,7607
 *   npx tsx scripts/stockx-autobuy-month.ts --go --limit=5
 *
 * Writes a machine-readable JSON summary to stdout tail (BEGIN_RESULT_JSON … END).
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { listUnlinkedStockxNeededThisMonth } from "@/lib/stockxAutoCheckout/queue";
import { loadShopifyLine } from "@/lib/stockxCheckout";
import {
  precheckStockxBuyability,
  resolveSlugFromStyleId,
} from "@/lib/stockxAutoCheckout/precheckAvailability";
import {
  styleIdFromSku,
  sizeFromSku,
  normSizeEU,
  runPrebuyDedupeCheck,
  type PrebuyDedupeResult,
} from "@/lib/stockxAutoCheckout/prebuyDedupe";
import {
  desiredStockxLaneFromShopify,
  detectShopifyExpress,
} from "@/lib/stockxAutoCheckout/detectShopifyExpress";
import {
  runShopifyBatchBuy,
  type ShopifyBatchBuyItem,
  type ShopifyBatchBuyItemResult,
} from "@/lib/stockxAutoCheckout/shopifyBatchBuy";
import { refreshStockxToken } from "@/lib/stockxSessionRefresh";
import { enrichOrderMatchFromStockxOrderNumber } from "@/lib/stockxAutoCheckout/enrichAfterLink";
import type { StockxDesiredLane } from "@/lib/stockxAutoCheckout/types";

const TITLE_EXCLUDE =
  /(bape|essentials|fear of god|crocs|yeezy slide|montre|watch|rolex)/i;

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(`--${name}=`.length);
}
const FLAGS = new Set(process.argv.slice(2));
const GO = FLAGS.has("--go") || FLAGS.has("--live");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TRANSIENT = /417|CONNECT|ECONNRESET|ETIMEDOUT|timeout|socket|network|EAI_AGAIN/i;
const RETRYABLE_BUY =
  /proxy_blank|empty.?lanes|price_moved|cloudflare|cf_abort|cf_sticky|timeout|proxy_blank/i;

type Candidate = {
  orderName: string;
  shopifyOrderId: string;
  createdAt: string;
  sellDateKey: string;
  netSalesChf: number;
  title: string;
  sku: string;
  sizeEU: string;
  lineItemId: string | null;
  lane: StockxDesiredLane;
  express: boolean;
  slug: string | null;
  precheckStatus: string;
  expectedBuyChf: number | null;
  marginPct: number | null;
};

type DerivedVerdict = {
  orderName: string;
  decision: "BUY_OK" | "SKIPPED_ALREADY" | "EXCLUDED" | "NO_SLUG" | "NOT_BUYABLE";
  reason: string;
  prebuyVerdict?: string;
  linkedStockxOrderNumber?: string | null;
  cand: Candidate;
};

async function prebuyWithRetry(
  cand: Candidate
): Promise<PrebuyDedupeResult> {
  let last: PrebuyDedupeResult | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await runPrebuyDedupeCheck(
      {
        shopifyOrderName: cand.orderName,
        shopifyOrderId: cand.shopifyOrderId,
        shopifyLineItemId: cand.lineItemId ?? "",
        shopifyCreatedAt: cand.createdAt,
        title: cand.title,
        sku: cand.sku,
        sizeEU: cand.sizeEU,
      },
      { linkIfClear: true }
    );
    last = res;
    // Only retry when the check itself failed on a transient network error.
    if (res.verdict === "SKIP_REASON" && TRANSIENT.test(res.detail)) {
      console.warn(`[prebuy] ${cand.orderName} transient (try ${attempt}): ${res.detail}`);
      await sleep(attempt * 4000);
      continue;
    }
    return res;
  }
  return last!;
}

async function derive(): Promise<DerivedVerdict[]> {
  const now = new Date();
  let unlinked = await listUnlinkedStockxNeededThisMonth(now);
  unlinked = unlinked
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const onlyRaw = arg("only");
  const only = onlyRaw
    ? new Set(onlyRaw.split(",").map((s) => (s.startsWith("#") ? s : `#${s.trim()}`)))
    : null;
  if (only) unlinked = unlinked.filter((o) => only.has(o.orderName));
  const limit = arg("limit") ? Number(arg("limit")) : null;

  console.log(
    `[derive] month unlinked=${unlinked.length}${only ? ` (filtered to ${only.size})` : ""}`
  );

  const verdicts: DerivedVerdict[] = [];
  let processed = 0;
  for (const o of unlinked) {
    if (limit && processed >= limit) break;
    processed++;
    let line;
    try {
      line = await loadShopifyLine(o.orderName);
    } catch (e: any) {
      verdicts.push({
        orderName: o.orderName,
        decision: "NOT_BUYABLE",
        reason: `loadShopifyLine failed: ${e?.message || e}`,
        cand: {
          orderName: o.orderName,
          shopifyOrderId: o.shopifyOrderId,
          createdAt: o.createdAt.toISOString(),
          sellDateKey: o.sellDateKey,
          netSalesChf: o.netSalesChf,
          title: "",
          sku: "",
          sizeEU: "",
          lineItemId: null,
          lane: "STANDARD",
          express: false,
          slug: null,
          precheckStatus: "load_failed",
          expectedBuyChf: null,
          marginPct: null,
        },
      });
      continue;
    }
    const express = detectShopifyExpress({
      deliveryMode: line.deliveryMode,
      deliveryModeLabel: line.deliveryModeLabel,
      shippingLineTitles: line.shippingLineTitles,
    });
    const lane = desiredStockxLaneFromShopify(express);
    const precheck = await precheckStockxBuyability({ line, desiredLane: lane });
    const styleId = styleIdFromSku(line.sku);
    const slug = styleId ? await resolveSlugFromStyleId(styleId) : null;
    const sizeEU = line.sizeEU || normSizeEU(sizeFromSku(line.sku)) || "";

    const cand: Candidate = {
      orderName: o.orderName,
      shopifyOrderId: o.shopifyOrderId,
      createdAt: o.createdAt.toISOString(),
      sellDateKey: o.sellDateKey,
      netSalesChf: o.netSalesChf,
      title: line.title,
      sku: line.sku,
      sizeEU,
      lineItemId: line.shopifyLineItemId,
      lane,
      express,
      slug,
      precheckStatus: precheck.status,
      expectedBuyChf: precheck.expectedBuyChf,
      marginPct: precheck.marginPct,
    };

    if (TITLE_EXCLUDE.test(line.title)) {
      verdicts.push({
        orderName: o.orderName,
        decision: "EXCLUDED",
        reason: `title excluded: ${line.title}`,
        cand,
      });
      continue;
    }
    if (precheck.status !== "buyable") {
      verdicts.push({
        orderName: o.orderName,
        decision: "NOT_BUYABLE",
        reason: `${precheck.status}: ${precheck.detail}`,
        cand,
      });
      continue;
    }
    if (!slug) {
      verdicts.push({
        orderName: o.orderName,
        decision: "NO_SLUG",
        reason: `no slug for sku=${line.sku} style=${styleId}`,
        cand,
      });
      continue;
    }

    // Prebuy dedupe gate.
    const prebuy = await prebuyWithRetry(cand);
    if (prebuy.verdict !== "BUY_OK") {
      verdicts.push({
        orderName: o.orderName,
        decision: "SKIPPED_ALREADY",
        reason: `${prebuy.verdict}: ${prebuy.detail}`,
        prebuyVerdict: prebuy.verdict,
        linkedStockxOrderNumber: prebuy.linkedStockxOrderNumber ?? null,
        cand,
      });
      console.log(`[dedupe] ${o.orderName} → ${prebuy.verdict} (${prebuy.detail})`);
      continue;
    }

    verdicts.push({
      orderName: o.orderName,
      decision: "BUY_OK",
      reason: `buyable ${lane} exp=${precheck.expectedBuyChf} margin=${
        precheck.marginPct == null ? "?" : (precheck.marginPct * 100).toFixed(1) + "%"
      }`,
      prebuyVerdict: "BUY_OK",
      cand,
    });
    console.log(
      `[buy-ok] ${o.orderName} ${lane} ${slug} ${sizeEU} exp=${precheck.expectedBuyChf}`
    );
  }
  return verdicts;
}

async function verifyBuy(orderName: string, cand: Candidate) {
  const om = await prisma.orderMatch.findFirst({
    where: { shopifyOrderName: orderName, stockxOrderNumber: { not: "" } },
    select: {
      id: true,
      stockxOrderNumber: true,
      supplierCost: true,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!om?.stockxOrderNumber) {
    return { orderName, verified: false, note: "no OrderMatch.stockxOrderNumber", om: null };
  }
  let supplierCost = om.supplierCost == null ? null : Number(om.supplierCost);
  const exp = cand.expectedBuyChf;
  // #7566 bug guard: cost suspiciously low vs expected buy → enrich from STX order.
  const suspicious =
    supplierCost != null &&
    exp != null &&
    supplierCost > 0 &&
    supplierCost < exp * 0.6;
  let enriched = false;
  if (suspicious) {
    console.warn(
      `[verify] ${orderName} supplierCost=${supplierCost} suspicious vs exp=${exp} — enrich ${om.stockxOrderNumber}`
    );
    try {
      const r = await enrichOrderMatchFromStockxOrderNumber({
        orderMatchId: om.id,
        stockxOrderNumber: om.stockxOrderNumber,
      });
      enriched = r.ok;
      if (r.ok) {
        const re = await prisma.orderMatch.findUnique({
          where: { id: om.id },
          select: { supplierCost: true },
        });
        supplierCost = re?.supplierCost == null ? supplierCost : Number(re.supplierCost);
      }
    } catch (e: any) {
      console.warn(`[verify] enrich failed ${orderName}: ${e?.message || e}`);
    }
  }
  return {
    orderName,
    verified: true,
    stockxOrderNumber: om.stockxOrderNumber,
    supplierCost,
    expectedBuyChf: exp,
    suspicious,
    enriched,
    om: null,
  };
}

async function main() {
  console.log(`=== stockx-autobuy-month ${GO ? "LIVE" : "DRY"} @ ${new Date().toISOString()} ===`);

  // 1) Tokens
  const tokenHealth: Record<string, string> = {};
  for (const account of ["default", "galaxus"] as const) {
    try {
      const r = await refreshStockxToken({ account });
      tokenHealth[account] = `${r.reason}${r.ok ? " ok" : " FAIL"}`;
      console.log(`[token] ${account}: ${JSON.stringify(r).slice(0, 200)}`);
    } catch (e: any) {
      tokenHealth[account] = `error:${e?.message || e}`;
      console.warn(`[token] ${account} refresh error: ${e?.message || e}`);
    }
  }

  // 2+3) Derive + dedupe
  const verdicts = await derive();
  const buyList = verdicts.filter((v) => v.decision === "BUY_OK");
  console.log(
    `[plan] BUY_OK=${buyList.length} SKIPPED=${
      verdicts.filter((v) => v.decision === "SKIPPED_ALREADY").length
    } EXCLUDED=${verdicts.filter((v) => v.decision === "EXCLUDED").length} NO_SLUG=${
      verdicts.filter((v) => v.decision === "NO_SLUG").length
    } NOT_BUYABLE=${verdicts.filter((v) => v.decision === "NOT_BUYABLE").length}`
  );

  const bought: any[] = [];
  const notBought: any[] = [];

  if (!GO) {
    console.log("[plan] DRY — not buying. Pass --go to execute.");
  } else if (buyList.length === 0) {
    console.log("[plan] nothing to buy.");
  } else {
    // Build items oldest-first (batch applies its own express-first sort internally).
    const remaining = new Map<string, DerivedVerdict>();
    for (const v of buyList) remaining.set(v.orderName, v);

    const MAX_PASSES = 3;
    for (let pass = 1; pass <= MAX_PASSES && remaining.size > 0; pass++) {
      const items: ShopifyBatchBuyItem[] = [...remaining.values()].map((v) => ({
        orderName: v.orderName,
        slug: v.cand.slug!,
        sizeEU: v.cand.sizeEU,
        lineItemId: v.cand.lineItemId,
        ship: v.cand.lane,
      }));
      console.log(`[buy] pass ${pass}/${MAX_PASSES} items=${items.length}`);
      let summary;
      try {
        summary = await runShopifyBatchBuy({
          items,
          dryRun: false,
          confirmLive: true,
        });
      } catch (e: any) {
        console.error(`[buy] batch threw pass ${pass}: ${e?.message || e}`);
        if (pass < MAX_PASSES) {
          await sleep(25000);
          continue;
        }
        break;
      }
      console.log(
        `[buy] pass ${pass} bought=${summary.bought} aborted=${summary.aborted} needsHuman=${summary.needsHuman} skipped=${summary.skipped} stoppedOn402=${summary.stoppedOn402} bw=${summary.bandwidthMb}MB`
      );

      for (const it of summary.items as ShopifyBatchBuyItemResult[]) {
        const v = remaining.get(it.orderName);
        const res: any = it.result;
        if (res.kind === "easy_buy") {
          remaining.delete(it.orderName);
          bought.push({
            orderName: it.orderName,
            lane: it.lane ?? v?.cand.lane,
            stockxOrderNumber: res.stockxOrderNumber ?? null,
            totalChf: res.totalChf ?? null,
          });
        } else if (res.kind === "skipped") {
          remaining.delete(it.orderName);
          // already matched during the buy session
          bought.push({
            orderName: it.orderName,
            lane: it.lane ?? v?.cand.lane,
            stockxOrderNumber: res.detail ?? null,
            totalChf: null,
            note: `skipped:${res.reason}`,
          });
        } else {
          const reason = res.reason || res.detail || "unknown";
          const retryable = RETRYABLE_BUY.test(String(reason)) && !summary.stoppedOn402;
          if (!retryable || pass === MAX_PASSES) {
            remaining.delete(it.orderName);
            notBought.push({
              orderName: it.orderName,
              reason: `${res.kind}:${reason}`,
              detail: res.detail ?? null,
              expectedBuyChf: v?.cand.expectedBuyChf ?? null,
            });
          } // else keep in remaining for next pass
        }
      }

      if (summary.stoppedOn402) {
        console.error("[buy] stopped on proxy 402 — remaining not attempted this run");
        for (const [name, v] of remaining) {
          notBought.push({
            orderName: name,
            reason: "proxy_402_quota_stop",
            expectedBuyChf: v.cand.expectedBuyChf,
          });
        }
        remaining.clear();
        break;
      }
      if (remaining.size > 0 && pass < MAX_PASSES) {
        console.log(`[buy] ${remaining.size} retryable left — sleep 25s then pass ${pass + 1}`);
        await sleep(25000);
      }
    }
  }

  // 5) Verify buys
  const verifications: any[] = [];
  for (const b of bought) {
    const v = buyList.find((x) => x.orderName === b.orderName);
    if (!v) continue;
    const ver = await verifyBuy(b.orderName, v.cand);
    verifications.push(ver);
    if (ver.verified && ver.stockxOrderNumber && !b.stockxOrderNumber) {
      b.stockxOrderNumber = ver.stockxOrderNumber;
    }
    if (ver.verified && ver.supplierCost != null) b.confirmChf = ver.supplierCost;
  }

  // Aggregate NOT BOUGHT from non-buy verdicts too.
  for (const v of verdicts) {
    if (v.decision === "BUY_OK") continue;
    notBought.push({
      orderName: v.orderName,
      reason: `${v.decision}:${v.reason}`,
      prebuyVerdict: v.prebuyVerdict ?? null,
      linkedStockxOrderNumber: v.linkedStockxOrderNumber ?? null,
      expectedBuyChf: v.cand.expectedBuyChf,
    });
  }

  const totalSpent = bought.reduce(
    (s, b) => s + (Number(b.confirmChf ?? b.totalChf ?? 0) || 0),
    0
  );

  const result = {
    mode: GO ? "LIVE" : "DRY",
    at: new Date().toISOString(),
    tokenHealth,
    counts: {
      derived: verdicts.length,
      buyOk: buyList.length,
      bought: bought.length,
      notBought: notBought.length,
    },
    bought,
    notBought,
    verifications,
    totalSpentChf: Number(totalSpent.toFixed(2)),
    derivedVerdicts: verdicts.map((v) => ({
      orderName: v.orderName,
      decision: v.decision,
      reason: v.reason,
      lane: v.cand.lane,
      slug: v.cand.slug,
      sizeEU: v.cand.sizeEU,
      expectedBuyChf: v.cand.expectedBuyChf,
      netSalesChf: v.cand.netSalesChf,
    })),
  };

  console.log("BEGIN_RESULT_JSON");
  console.log(JSON.stringify(result, null, 2));
  console.log("END_RESULT_JSON");
}

main()
  .catch((e) => {
    console.error("FATAL", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
