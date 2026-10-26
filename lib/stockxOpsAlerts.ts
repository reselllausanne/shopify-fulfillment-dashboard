/**
 * Operator-facing StockX order issue alerts.
 *
 * Sends the OPERATOR (STOCKX_ALERT_EMAIL) a digest BEFORE any customer-facing flow when a
 * linked StockX buy is cancelled / refunded, running late (ETA passed, not shipped), or a
 * paid Galaxus STX line has no StockX buy after N days ("not purchased").
 *
 * Customer milestone emails (app/lib/notifications/stockxEmail.ts) deliberately SKIP
 * cancelled/refunded + eta_passed, so these never leak to customers — the operator is the
 * only recipient here.
 *
 * Dedup: one StockxOrderAlert row per (scope, alertType, refKey). Re-running never re-mails
 * the same issue.
 */
import { prisma } from "@/app/lib/prisma";
import { getMailer } from "@/app/lib/mailer";
import { filterGalaxusLinesNeedingStockxAutoLink } from "@/galaxus/orders/autoLinkStockxBuys";

const DAY_MS = 86_400_000;

const STX_LINE_FILTER = {
  OR: [
    { providerKey: { startsWith: "STX_", mode: "insensitive" as const } },
    { supplierVariantId: { startsWith: "stx_", mode: "insensitive" as const } },
    { supplierPid: { startsWith: "STX_", mode: "insensitive" as const } },
  ],
};

type AlertScope = "shopify" | "galaxus";
type AlertType = "CANCELLED" | "REFUNDED" | "DELAYED" | "NOT_PURCHASED";

type PendingAlert = {
  scope: AlertScope;
  alertType: AlertType;
  refKey: string;
  orderRef: string | null;
  stockxOrderNumber: string | null;
  productTitle: string | null;
  detail: string | null;
};

export type StockxOpsAlertResult = {
  ok: boolean;
  error?: string;
  candidates: number;
  newAlerts: number;
  emailed: boolean;
  emailTo: string | null;
  byType: Record<AlertType, number>;
  skippedExisting: number;
};

function statusKey(s: string | null | undefined): string {
  return String(s ?? "").trim().toUpperCase();
}

function isCancelledStatus(s: string | null | undefined): boolean {
  return statusKey(s).includes("CANCEL");
}
function isRefundedStatus(s: string | null | undefined): boolean {
  return statusKey(s).includes("REFUND");
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

export async function runStockxOrderOpsAlerts(options?: {
  days?: number;
  notPurchasedAgeDays?: number;
  dryRun?: boolean;
}): Promise<StockxOpsAlertResult> {
  const days = Math.max(1, Math.min(120, Number(options?.days ?? 30)));
  const notPurchasedAgeDays = Math.max(1, Math.min(60, Number(options?.notPurchasedAgeDays ?? 2)));
  const dryRun = Boolean(options?.dryRun);
  const now = Date.now();
  const since = new Date(now - days * DAY_MS);
  const notPurchasedCutoff = new Date(now - notPurchasedAgeDays * DAY_MS);

  const result: StockxOpsAlertResult = {
    ok: true,
    candidates: 0,
    newAlerts: 0,
    emailed: false,
    emailTo: null,
    byType: { CANCELLED: 0, REFUNDED: 0, DELAYED: 0, NOT_PURCHASED: 0 },
    skippedExisting: 0,
  };

  const prismaAny = prisma as any;
  const pending: PendingAlert[] = [];

  // ---- Shopify: cancelled / refunded / delayed (linked OrderMatch) ----
  try {
    const shopifyMatches = await prisma.orderMatch.findMany({
      where: {
        shopifyCreatedAt: { gte: since },
        stockxOrderNumber: { not: "" },
      },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderName: true,
        shopifyProductTitle: true,
        stockxOrderNumber: true,
        stockxStatus: true,
        stockxEstimatedDelivery: true,
        stockxLatestEstimatedDelivery: true,
      },
    });

    // Delayed rows need a fulfillment check — batch fetch fulfilled order ids.
    const orderIds = Array.from(
      new Set(shopifyMatches.map((m) => m.shopifyOrderId).filter((v): v is string => Boolean(v)))
    );
    const fulfilled = orderIds.length
      ? await prisma.shopifyFulfillmentRecord.findMany({
          where: { shopifyOrderId: { in: orderIds } },
          select: { shopifyOrderId: true },
        })
      : [];
    const fulfilledSet = new Set(fulfilled.map((f) => f.shopifyOrderId));

    for (const m of shopifyMatches) {
      if (isCancelledStatus(m.stockxStatus)) {
        pending.push({
          scope: "shopify",
          alertType: "CANCELLED",
          refKey: m.id,
          orderRef: m.shopifyOrderName ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.shopifyProductTitle ?? null,
          detail: `StockX status ${statusKey(m.stockxStatus)}`,
        });
        continue;
      }
      if (isRefundedStatus(m.stockxStatus)) {
        pending.push({
          scope: "shopify",
          alertType: "REFUNDED",
          refKey: m.id,
          orderRef: m.shopifyOrderName ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.shopifyProductTitle ?? null,
          detail: `StockX status ${statusKey(m.stockxStatus)}`,
        });
        continue;
      }
      // Delayed: ETA passed, not fulfilled on Shopify.
      const eta = m.stockxLatestEstimatedDelivery || m.stockxEstimatedDelivery;
      if (eta && eta.getTime() < now && !fulfilledSet.has(m.shopifyOrderId ?? "")) {
        pending.push({
          scope: "shopify",
          alertType: "DELAYED",
          refKey: m.id,
          orderRef: m.shopifyOrderName ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.shopifyProductTitle ?? null,
          detail: `ETA ${fmtDate(eta)} passed, not shipped`,
        });
      }
    }
  } catch (err: any) {
    console.warn("[STOCKX][OPS_ALERT] shopify scan failed:", err?.message ?? err);
  }

  // ---- Galaxus: cancelled / refunded / delayed (linked GalaxusStockxMatch) ----
  try {
    const gxMatches = await prismaAny.galaxusStockxMatch.findMany({
      where: {
        createdAt: { gte: since },
        stockxOrderNumber: { not: "" },
      },
      select: {
        id: true,
        galaxusOrderRef: true,
        galaxusProductName: true,
        stockxOrderNumber: true,
        stockxStatus: true,
        stockxEstimatedDelivery: true,
        stockxLatestEstimatedDelivery: true,
      },
    });
    for (const m of gxMatches) {
      if (isCancelledStatus(m.stockxStatus)) {
        pending.push({
          scope: "galaxus",
          alertType: "CANCELLED",
          refKey: String(m.id),
          orderRef: m.galaxusOrderRef ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.galaxusProductName ?? null,
          detail: `StockX status ${statusKey(m.stockxStatus)}`,
        });
        continue;
      }
      if (isRefundedStatus(m.stockxStatus)) {
        pending.push({
          scope: "galaxus",
          alertType: "REFUNDED",
          refKey: String(m.id),
          orderRef: m.galaxusOrderRef ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.galaxusProductName ?? null,
          detail: `StockX status ${statusKey(m.stockxStatus)}`,
        });
        continue;
      }
      const eta = m.stockxLatestEstimatedDelivery || m.stockxEstimatedDelivery;
      if (eta && new Date(eta).getTime() < now) {
        pending.push({
          scope: "galaxus",
          alertType: "DELAYED",
          refKey: String(m.id),
          orderRef: m.galaxusOrderRef ?? null,
          stockxOrderNumber: m.stockxOrderNumber ?? null,
          productTitle: m.galaxusProductName ?? null,
          detail: `ETA ${fmtDate(eta)} passed, not delivered`,
        });
      }
    }
  } catch (err: any) {
    console.warn("[STOCKX][OPS_ALERT] galaxus scan failed:", err?.message ?? err);
  }

  // ---- Galaxus: not-purchased (paid STX line, no buy linked after N days) ----
  try {
    const orders = await prismaAny.galaxusOrder.findMany({
      where: {
        archivedAt: null,
        cancelledAt: null,
        orderDate: { gte: since, lte: notPurchasedCutoff },
        lines: { some: STX_LINE_FILTER },
      },
      include: { lines: true },
    });
    if (orders.length > 0) {
      const matches = await prismaAny.galaxusStockxMatch.findMany({
        where: { galaxusOrderId: { in: orders.map((o: any) => o.id) } },
        select: { galaxusOrderId: true, galaxusOrderLineId: true, stockxOrderNumber: true },
      });
      const byOrder = new Map<string, any[]>();
      for (const m of matches) {
        const k = String(m.galaxusOrderId);
        const arr = byOrder.get(k) ?? [];
        arr.push(m);
        byOrder.set(k, arr);
      }
      for (const order of orders) {
        const needing = filterGalaxusLinesNeedingStockxAutoLink(
          order.lines ?? [],
          byOrder.get(order.id) ?? []
        );
        if (needing.length === 0) continue;
        const titles = needing
          .map((l: any) => String(l.productName ?? l.description ?? "").trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(", ");
        pending.push({
          scope: "galaxus",
          alertType: "NOT_PURCHASED",
          refKey: String(order.id),
          orderRef: String(order.galaxusOrderId ?? order.id),
          stockxOrderNumber: null,
          productTitle: titles || null,
          detail: `${needing.length} STX unit(s) unbought since ${fmtDate(order.orderDate)}`,
        });
      }
    }
  } catch (err: any) {
    console.warn("[STOCKX][OPS_ALERT] galaxus not-purchased scan failed:", err?.message ?? err);
  }

  result.candidates = pending.length;
  if (pending.length === 0) return result;

  // Dedup against already-alerted rows.
  const existing = await prismaAny.stockxOrderAlert.findMany({
    where: {
      OR: pending.map((p) => ({
        scope: p.scope,
        alertType: p.alertType,
        refKey: p.refKey,
      })),
    },
    select: { scope: true, alertType: true, refKey: true },
  });
  const existingKeys = new Set(
    existing.map((e: any) => `${e.scope}|${e.alertType}|${e.refKey}`)
  );
  const fresh = pending.filter(
    (p) => !existingKeys.has(`${p.scope}|${p.alertType}|${p.refKey}`)
  );
  result.skippedExisting = pending.length - fresh.length;
  if (fresh.length === 0) return result;

  for (const p of fresh) result.byType[p.alertType] += 1;
  result.newAlerts = fresh.length;

  const operator =
    (process.env.STOCKX_ALERT_EMAIL || "").trim() ||
    (process.env.POSTMARK_FROM_EMAIL || "").trim();
  result.emailTo = operator || null;

  if (dryRun) return result;

  // Send ONE operator digest.
  if (operator) {
    const { text, html, subject } = buildDigest(fresh, result.byType);
    try {
      const sendRes = await getMailer().sendRawEmail({
        to: operator,
        subject,
        textBody: text,
        htmlBody: html,
        ignoreOverride: true,
      });
      result.emailed = Boolean(sendRes.ok);
      if (!sendRes.ok) {
        result.error = sendRes.error;
        console.warn("[STOCKX][OPS_ALERT] email failed:", sendRes.error);
      }
    } catch (err: any) {
      result.error = String(err?.message ?? err);
      console.warn("[STOCKX][OPS_ALERT] email threw:", result.error);
    }
  } else {
    result.error = "no_operator_email";
  }

  // Persist dedup rows only after a successful send (so a failed email retries next run).
  if (result.emailed || !operator) {
    try {
      await prismaAny.stockxOrderAlert.createMany({
        data: fresh.map((p) => ({
          scope: p.scope,
          alertType: p.alertType,
          refKey: p.refKey,
          orderRef: p.orderRef,
          stockxOrderNumber: p.stockxOrderNumber,
          productTitle: p.productTitle,
          detail: p.detail,
          emailTo: operator || null,
        })),
        skipDuplicates: true,
      });
    } catch (err: any) {
      console.warn("[STOCKX][OPS_ALERT] persist failed:", err?.message ?? err);
    }
  }

  return result;
}

const TYPE_LABEL: Record<AlertType, string> = {
  CANCELLED: "Annulations StockX",
  REFUNDED: "Remboursements StockX",
  DELAYED: "Retards (ETA depassee)",
  NOT_PURCHASED: "Non achetes (buy manquant)",
};

function buildDigest(
  alerts: PendingAlert[],
  byType: Record<AlertType, number>
): { subject: string; text: string; html: string } {
  const order: AlertType[] = ["CANCELLED", "REFUNDED", "DELAYED", "NOT_PURCHASED"];
  const parts: string[] = [];
  const subjParts: string[] = [];
  if (byType.CANCELLED) subjParts.push(`${byType.CANCELLED} annul`);
  if (byType.REFUNDED) subjParts.push(`${byType.REFUNDED} remb`);
  if (byType.DELAYED) subjParts.push(`${byType.DELAYED} retard`);
  if (byType.NOT_PURCHASED) subjParts.push(`${byType.NOT_PURCHASED} non-achat`);
  const subject = `[Resell OPS] StockX: ${alerts.length} alerte(s) — ${subjParts.join(", ")}`;

  const lines: string[] = ["Alertes StockX (operateur d'abord):", ""];
  const htmlBlocks: string[] = [
    `<h2 style="font-family:Arial,sans-serif;">Alertes StockX</h2>`,
  ];

  for (const t of order) {
    const group = alerts.filter((a) => a.alertType === t);
    if (group.length === 0) continue;
    lines.push(`== ${TYPE_LABEL[t]} (${group.length}) ==`);
    htmlBlocks.push(
      `<h3 style="font-family:Arial,sans-serif;margin:16px 0 4px;">${TYPE_LABEL[t]} (${group.length})</h3><ul style="font-family:Arial,sans-serif;">`
    );
    for (const a of group) {
      const ref = a.orderRef ?? a.refKey;
      const chan = a.scope === "shopify" ? "Shopify" : "Galaxus";
      const stx = a.stockxOrderNumber ? ` · StockX ${a.stockxOrderNumber}` : "";
      const prod = a.productTitle ? ` · ${a.productTitle}` : "";
      const det = a.detail ? ` — ${a.detail}` : "";
      lines.push(`- [${chan}] ${ref}${stx}${prod}${det}`);
      htmlBlocks.push(
        `<li>[${chan}] <b>${escapeHtml(ref)}</b>${escapeHtml(stx)}${escapeHtml(prod)}${escapeHtml(det)}</li>`
      );
    }
    lines.push("");
    htmlBlocks.push("</ul>");
  }

  return {
    subject,
    text: lines.join("\n"),
    html: htmlBlocks.join("\n"),
  };
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
