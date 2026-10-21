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

/** Public dashboard base (same sources as StockX auth alerts). */
export function stockxAdminBaseUrl(): string {
  const raw =
    process.env.STOCKX_ALERT_BASE_URL?.trim() ||
    process.env.RETURNS_PUBLIC_BASE_URL?.trim() ||
    process.env.SHOPIFY_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    "https://solution.resell-lausanne.ch";
  return raw.replace(/\/+$/, "");
}

/** Deep link to admin checkout for this Shopify order (+ optional line). */
export function adminStockxCheckoutUrl(
  orderName: string,
  lineItemId?: string | null,
  baseUrl: string = stockxAdminBaseUrl()
): string {
  const params = new URLSearchParams();
  params.set("order", orderName.startsWith("#") ? orderName : `#${orderName}`);
  if (lineItemId) params.set("lineItemId", lineItemId);
  return `${baseUrl}/admin/stockx-checkout?${params.toString()}`;
}

export function productUrlForEmail(item: StockxNeedsHumanPayload): string | null {
  if (item.slug) {
    return `https://stockx.com/fr-fr/${item.slug.replace(/^\/+/, "")}`;
  }
  if (item.productUrl) {
    return item.productUrl.split("?")[0] || item.productUrl;
  }
  return null;
}

export function buyUrlForEmail(item: StockxNeedsHumanPayload): string | null {
  if (item.buyUrl && /^https?:\/\//i.test(item.buyUrl)) return item.buyUrl;
  const product = productUrlForEmail(item);
  if (product && item.sizeUS) {
    return `${product}?size=${encodeURIComponent(String(item.sizeUS).trim())}`;
  }
  return product;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkOrDash(url: string | null, label: string): string {
  if (!url) return "—";
  return `${label}: ${url}`;
}

/**
 * Ops email body (FR-friendly). Absolute https links for product / buy / admin.
 */
export function formatNeedsHumanEmailBody(
  items: StockxNeedsHumanPayload[],
  opts?: { heading?: string; baseUrl?: string }
): string {
  const base = opts?.baseUrl || stockxAdminBaseUrl();
  const lines: string[] = [
    opts?.heading || "StockX auto-checkout — action manuelle requise",
    `Nombre: ${items.length}`,
    `À: ${new Date().toISOString()}`,
    `Admin: ${base}/admin/stockx-checkout`,
    "",
  ];
  for (const item of items) {
    const productUrl = productUrlForEmail(item);
    const buyUrl = buyUrlForEmail(item);
    const adminUrl = adminStockxCheckoutUrl(
      item.shopifyOrderName,
      item.shopifyLineItemId,
      base
    );
    lines.push("———");
    lines.push(`Shopify #: ${item.shopifyOrderName}`);
    lines.push(`Line: ${item.shopifyLineItemId || "—"}`);
    lines.push(`Titre: ${item.title}`);
    lines.push(`SKU: ${item.sku || "—"}`);
    lines.push(`Vente: ${item.saleChf != null ? `${item.saleChf.toFixed(2)} CHF` : "—"}`);
    lines.push(`Taille EU: ${item.sizeEU} · Taille US: ${item.sizeUS || "—"}`);
    lines.push(`Lane désirée (depuis Shopify Express): ${item.desiredLane}`);
    lines.push(`Raison: ${reasonFr(item)}`);
    lines.push(`Slug: ${item.slug || "—"}`);
    lines.push(linkOrDash(productUrl, "Product URL"));
    lines.push(linkOrDash(buyUrl, "Buy URL (size US)"));
    lines.push(`Dashboard: ${adminUrl}`);
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

/** HTML twin with clickable product / buy / dashboard links. */
export function formatNeedsHumanEmailHtml(
  items: StockxNeedsHumanPayload[],
  opts?: { heading?: string; baseUrl?: string }
): string {
  const base = opts?.baseUrl || stockxAdminBaseUrl();
  const heading = opts?.heading || "StockX auto-checkout — action manuelle requise";
  const blocks: string[] = [
    `<h2>${escapeHtml(heading)}</h2>`,
    `<p>Nombre: <strong>${items.length}</strong><br/>À: ${escapeHtml(new Date().toISOString())}<br/>`,
    `<a href="${escapeHtml(`${base}/admin/stockx-checkout`)}">Admin StockX checkout</a></p>`,
  ];
  for (const item of items) {
    const productUrl = productUrlForEmail(item);
    const buyUrl = buyUrlForEmail(item);
    const adminUrl = adminStockxCheckoutUrl(
      item.shopifyOrderName,
      item.shopifyLineItemId,
      base
    );
    const a = (href: string | null, label: string) =>
      href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a> <span style="color:#666;font-size:12px">(${escapeHtml(href)})</span>`
        : "—";
    blocks.push("<hr/>");
    blocks.push("<div>");
    blocks.push(`<p><strong>Shopify #:</strong> ${escapeHtml(item.shopifyOrderName)}<br/>`);
    blocks.push(`<strong>Line:</strong> ${escapeHtml(item.shopifyLineItemId || "—")}<br/>`);
    blocks.push(`<strong>Titre:</strong> ${escapeHtml(item.title)}<br/>`);
    blocks.push(`<strong>SKU:</strong> ${escapeHtml(item.sku || "—")}<br/>`);
    blocks.push(
      `<strong>Vente:</strong> ${item.saleChf != null ? `${item.saleChf.toFixed(2)} CHF` : "—"}<br/>`
    );
    blocks.push(
      `<strong>Taille:</strong> ${escapeHtml(item.sizeEU)} · US ${escapeHtml(item.sizeUS || "—")}<br/>`
    );
    blocks.push(
      `<strong>Lane désirée:</strong> ${escapeHtml(item.desiredLane)}<br/>`
    );
    blocks.push(`<strong>Raison:</strong> ${escapeHtml(reasonFr(item))}<br/>`);
    blocks.push(`<strong>Slug:</strong> ${escapeHtml(item.slug || "—")}</p>`);
    blocks.push(`<p>Product: ${a(productUrl, "ouvrir produit")}<br/>`);
    blocks.push(`Buy (?size=US): ${a(buyUrl, "ouvrir buy")}<br/>`);
    blocks.push(`Dashboard: ${a(adminUrl, "ouvrir checkout admin")}</p>`);
    if (item.recommended) {
      blocks.push(`<p>Recommandé: ${escapeHtml(formatLane(item.recommended))}</p>`);
    }
    if (item.lanes.length) {
      blocks.push("<ul>");
      for (const lane of item.lanes) {
        blocks.push(`<li>${escapeHtml(formatLane(lane))}</li>`);
      }
      blocks.push("</ul>");
    }
    if (item.screenshotRel) {
      blocks.push(
        `<p style="font-size:12px;color:#666">Screenshot VPS: .data/${escapeHtml(item.screenshotRel)}</p>`
      );
    }
    blocks.push("</div>");
  }
  return blocks.join("\n");
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
  const html = formatNeedsHumanEmailHtml(items);
  const sent = await sendStockxEmail(subject, text, html);
  if (!sent) {
    console.error(
      "[STOCKX-AUTO] needs-human email not sent — check POSTMARK_SERVER_TOKEN, POSTMARK_FROM_EMAIL, STOCKX_ALERT_EMAIL"
    );
  }
  return { sent, count: items.length };
}
