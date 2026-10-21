import { sendStockxEmail } from "@/lib/stockxAuthAlert";
import {
  STOCKX_NEEDS_HUMAN_REASON_FR,
  type StockxNeedsHumanPayload,
} from "@/lib/stockxAutoCheckout/types";

function formatLane(lane: { rawLabel: string; totalChf: number; eta?: string | null }): string {
  const eta = lane.eta ? ` · ETA ${lane.eta}` : "";
  return `${lane.rawLabel}: ${lane.totalChf.toFixed(2)} CHF${eta}`;
}

function reasonFr(item: StockxNeedsHumanPayload): string {
  const label = STOCKX_NEEDS_HUMAN_REASON_FR[item.reason] || item.reason;
  return item.detail ? `${label} — ${item.detail}` : label;
}

/**
 * Ops email body (FR-friendly). One block per Shopify line needing human.
 */
export function formatNeedsHumanEmailBody(
  items: StockxNeedsHumanPayload[],
  opts?: { heading?: string }
): string {
  const lines: string[] = [
    opts?.heading || "StockX auto-checkout — action manuelle requise",
    `Nombre: ${items.length}`,
    `À: ${new Date().toISOString()}`,
    "Admin: /admin/stockx-checkout (VNC + preview)",
    "",
  ];
  for (const item of items) {
    lines.push("———");
    lines.push(`Shopify #: ${item.shopifyOrderName}`);
    lines.push(`Line: ${item.shopifyLineItemId || "—"}`);
    lines.push(`Titre: ${item.title}`);
    lines.push(`SKU: ${item.sku || "—"}`);
    lines.push(`Vente: ${item.saleChf != null ? `${item.saleChf.toFixed(2)} CHF` : "—"}`);
    lines.push(`Taille EU: ${item.sizeEU} · Taille US: ${item.sizeUS || "—"}`);
    lines.push(
      `Lane désirée (depuis Shopify Express): ${item.desiredLane}`
    );
    lines.push(`Raison: ${reasonFr(item)}`);
    lines.push(`Slug: ${item.slug || "—"}`);
    lines.push(`Product URL: ${item.productUrl || "—"}`);
    lines.push(`Buy URL (size US): ${item.buyUrl || "—"}`);
    if (item.recommended) {
      lines.push(`Recommandé: ${formatLane(item.recommended)}`);
    }
    if (item.lanes.length) {
      lines.push("Toutes les lanes (prix / ETA):");
      for (const lane of item.lanes) lines.push(`  - ${formatLane(lane)}`);
    } else {
      lines.push("Lanes: (aucune parsée)");
    }
    if (item.screenshotRel) {
      lines.push(`Screenshot VPS: .data/${item.screenshotRel}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function needsHumanEmailSubject(count: number): string {
  return `[Resell] StockX auto-checkout — action manuelle (${count})`;
}

export async function emailStockxNeedsHuman(
  items: StockxNeedsHumanPayload[],
  opts?: { subject?: string }
): Promise<{ sent: boolean; count: number }> {
  if (!items.length) return { sent: false, count: 0 };
  const subject = opts?.subject || needsHumanEmailSubject(items.length);
  const text = formatNeedsHumanEmailBody(items);
  const sent = await sendStockxEmail(subject, text);
  if (!sent) {
    console.error(
      "[STOCKX-AUTO] needs-human email not sent — check POSTMARK_SERVER_TOKEN, POSTMARK_FROM_EMAIL, STOCKX_ALERT_EMAIL"
    );
  }
  return { sent, count: items.length };
}
