import { sendStockxEmail } from "@/lib/stockxAuthAlert";
import type { StockxNeedsHumanPayload } from "@/lib/stockxAutoCheckout/types";

function formatLane(lane: { rawLabel: string; totalChf: number; eta?: string | null }): string {
  const eta = lane.eta ? ` · ETA ${lane.eta}` : "";
  return `${lane.rawLabel}: ${lane.totalChf.toFixed(2)} CHF${eta}`;
}

export function formatNeedsHumanEmailBody(
  items: StockxNeedsHumanPayload[],
  opts?: { heading?: string }
): string {
  const lines: string[] = [
    opts?.heading || "StockX auto-checkout: needs human",
    `Count: ${items.length}`,
    `At: ${new Date().toISOString()}`,
    "",
  ];
  for (const item of items) {
    lines.push("———");
    lines.push(`Shopify: ${item.shopifyOrderName}`);
    lines.push(`Line: ${item.shopifyLineItemId || "—"}`);
    lines.push(`Title: ${item.title}`);
    lines.push(`SKU: ${item.sku || "—"}`);
    lines.push(`Sale: ${item.saleChf != null ? `${item.saleChf.toFixed(2)} CHF` : "—"}`);
    lines.push(`Size EU: ${item.sizeEU} · Size US: ${item.sizeUS || "—"}`);
    lines.push(`Desired lane: ${item.desiredLane}`);
    lines.push(`Reason: ${item.reason}${item.detail ? ` (${item.detail})` : ""}`);
    lines.push(`Slug: ${item.slug || "—"}`);
    lines.push(`Product: ${item.productUrl || "—"}`);
    lines.push(`Buy URL: ${item.buyUrl || "—"}`);
    if (item.recommended) {
      lines.push(`Recommended: ${formatLane(item.recommended)}`);
    }
    if (item.lanes.length) {
      lines.push("Lanes:");
      for (const lane of item.lanes) lines.push(`  - ${formatLane(lane)}`);
    } else {
      lines.push("Lanes: (none parsed)");
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function emailStockxNeedsHuman(
  items: StockxNeedsHumanPayload[],
  opts?: { subject?: string }
): Promise<{ sent: boolean; count: number }> {
  if (!items.length) return { sent: false, count: 0 };
  const subject =
    opts?.subject ||
    `[Resell] StockX auto-checkout needs human (${items.length})`;
  const text = formatNeedsHumanEmailBody(items);
  const sent = await sendStockxEmail(subject, text);
  return { sent, count: items.length };
}
