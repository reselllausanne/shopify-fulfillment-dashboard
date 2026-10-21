/**
 * Ops email for MEDIUM (yellow) Shopify↔StockX auto-link candidates.
 * Cron does not auto-write these — human confirms on the match dashboard.
 * Deduped on disk so the same line+buy is not re-emailed every hour.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { sendStockxEmail } from "@/lib/stockxAuthAlert";
import { stockxAdminBaseUrl } from "@/lib/stockxAutoCheckout/emailNeedsHuman";

const STATE_FILE = path.join(
  process.cwd(),
  ".data",
  "shopify-autolink-medium-email-state.json"
);
/** Re-notify after this if still unmatched (same line + StockX #). */
const DEDUPE_MS = 7 * 24 * 60 * 60 * 1000;

export type MediumMatchEmailItem = {
  shopifyOrderName: string;
  shopifyLineItemId: string;
  shopifyTitle: string;
  shopifySku?: string | null;
  shopifySizeEU?: string | null;
  stockxOrderNumber: string;
  stockxOrderId?: string | null;
  stockxTitle?: string | null;
  stockxSizeEU?: string | null;
  stockxSkuKey?: string | null;
  score: number;
  confidence: "medium" | "low";
  reasons: string[];
  timeDiffHours?: number | null;
  suggestedCost?: number | null;
  urlKey?: string | null;
};

type EmailState = { sent?: Record<string, string> };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mediumCandidateDedupeKey(item: MediumMatchEmailItem): string {
  const line = String(item.shopifyLineItemId || "").trim();
  const stx = String(item.stockxOrderNumber || "").trim();
  return `${line}::${stx}`;
}

async function readState(): Promise<EmailState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as EmailState;
  } catch {
    return {};
  }
}

async function writeState(state: EmailState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** Drop keys older than DEDUPE_MS; return keys still within window. */
export function filterFreshDedupeKeys(
  sent: Record<string, string>,
  nowMs: number = Date.now()
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, iso] of Object.entries(sent)) {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && nowMs - t < DEDUPE_MS) out[key] = iso;
  }
  return out;
}

export function productUrlFromUrlKey(urlKey?: string | null): string | null {
  const slug = String(urlKey ?? "")
    .trim()
    .replace(/^\/+/, "");
  if (!slug) return null;
  return `https://stockx.com/fr-fr/${slug}`;
}

/** Match dashboard (home Order Matching) deep-ish link. */
export function adminMatchUrl(
  orderName: string,
  baseUrl: string = stockxAdminBaseUrl()
): string {
  const name = orderName.startsWith("#") ? orderName : `#${orderName}`;
  const params = new URLSearchParams();
  params.set("order", name);
  return `${baseUrl.replace(/\/+$/, "")}/?${params.toString()}`;
}

export function mediumOpsEmailSubject(mediumCount: number, lowCount: number): string {
  const lowBit = lowCount > 0 ? ` · low ${lowCount}` : "";
  return `[Resell] StockX↔Shopify match jaune — action manuelle (${mediumCount}${lowBit})`;
}

export function formatMediumOpsEmailBody(
  medium: MediumMatchEmailItem[],
  opts?: { lowBrief?: MediumMatchEmailItem[]; baseUrl?: string }
): string {
  const base = opts?.baseUrl || stockxAdminBaseUrl();
  const low = opts?.lowBrief ?? [];
  const lines: string[] = [
    "StockX↔Shopify auto-link — candidats JAUNE (medium)",
    "HIGH auto-liés silencieusement. Ces lignes nécessitent validation manuelle.",
    `Medium: ${medium.length}${low.length ? ` · Low (brief): ${low.length}` : ""}`,
    `À: ${new Date().toISOString()}`,
    `Match dashboard: ${base}/`,
    "",
  ];

  for (const item of medium) {
    const productUrl = productUrlFromUrlKey(item.urlKey);
    const matchUrl = adminMatchUrl(item.shopifyOrderName, base);
    lines.push("———");
    lines.push(`Shopify #: ${item.shopifyOrderName}`);
    lines.push(`Line: ${item.shopifyLineItemId}`);
    lines.push(`Titre Shopify: ${item.shopifyTitle}`);
    lines.push(`SKU Shopify: ${item.shopifySku || "—"} · Taille: ${item.shopifySizeEU || "—"}`);
    lines.push(`StockX #: ${item.stockxOrderNumber}`);
    if (item.stockxOrderId && item.stockxOrderId !== item.stockxOrderNumber) {
      lines.push(`StockX orderId: ${item.stockxOrderId}`);
    }
    lines.push(`Titre StockX: ${item.stockxTitle || "—"}`);
    lines.push(`SKU StockX: ${item.stockxSkuKey || "—"} · Taille: ${item.stockxSizeEU || "—"}`);
    lines.push(
      `Score: ${item.score} · Confidence: ${item.confidence}` +
        (item.timeDiffHours != null ? ` · Δh: ${item.timeDiffHours}` : "")
    );
    if (item.suggestedCost != null) {
      lines.push(`Coût suggéré: ${item.suggestedCost.toFixed(2)} CHF`);
    }
    lines.push(`Raisons: ${item.reasons.length ? item.reasons.join("; ") : "—"}`);
    lines.push(productUrl ? `Buy/Product URL: ${productUrl}` : "Buy/Product URL: —");
    lines.push(`Match dashboard: ${matchUrl}`);
    lines.push("");
  }

  if (low.length) {
    lines.push("——— LOW (brief, non auto-liés) ———");
    for (const item of low.slice(0, 15)) {
      lines.push(
        `- ${item.shopifyOrderName} ↔ ${item.stockxOrderNumber} (score=${item.score}) ${item.shopifyTitle}`
      );
    }
    if (low.length > 15) lines.push(`… +${low.length - 15} autres`);
    lines.push("");
  }

  return lines.join("\n");
}

export function formatMediumOpsEmailHtml(
  medium: MediumMatchEmailItem[],
  opts?: { lowBrief?: MediumMatchEmailItem[]; baseUrl?: string }
): string {
  const base = opts?.baseUrl || stockxAdminBaseUrl();
  const low = opts?.lowBrief ?? [];
  const blocks: string[] = [
    `<h2>StockX↔Shopify — candidats JAUNE (medium)</h2>`,
    `<p>HIGH auto-liés silencieusement. Validation manuelle requise.<br/>`,
    `Medium: <strong>${medium.length}</strong>`,
    low.length ? ` · Low (brief): <strong>${low.length}</strong>` : "",
    `<br/>À: ${escapeHtml(new Date().toISOString())}<br/>`,
    `<a href="${escapeHtml(`${base}/`)}">Match dashboard</a></p>`,
  ];

  for (const item of medium) {
    const productUrl = productUrlFromUrlKey(item.urlKey);
    const matchUrl = adminMatchUrl(item.shopifyOrderName, base);
    const a = (href: string | null, label: string) =>
      href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
        : "—";
    blocks.push("<hr/><div>");
    blocks.push(`<p><strong>Shopify #:</strong> ${escapeHtml(item.shopifyOrderName)}<br/>`);
    blocks.push(`<strong>Line:</strong> ${escapeHtml(item.shopifyLineItemId)}<br/>`);
    blocks.push(`<strong>Titre Shopify:</strong> ${escapeHtml(item.shopifyTitle)}<br/>`);
    blocks.push(
      `<strong>SKU / taille:</strong> ${escapeHtml(item.shopifySku || "—")} · ${escapeHtml(item.shopifySizeEU || "—")}<br/>`
    );
    blocks.push(`<strong>StockX #:</strong> ${escapeHtml(item.stockxOrderNumber)}<br/>`);
    blocks.push(`<strong>Titre StockX:</strong> ${escapeHtml(item.stockxTitle || "—")}<br/>`);
    blocks.push(
      `<strong>Score:</strong> ${item.score} · <strong>${escapeHtml(item.confidence)}</strong>` +
        (item.timeDiffHours != null ? ` · Δh ${item.timeDiffHours}` : "") +
        `<br/>`
    );
    blocks.push(
      `<strong>Raisons:</strong> ${escapeHtml(item.reasons.join("; ") || "—")}</p>`
    );
    blocks.push(`<p>Product/Buy: ${a(productUrl, "ouvrir StockX")}<br/>`);
    blocks.push(`Dashboard: ${a(matchUrl, "ouvrir match")}</p>`);
    blocks.push("</div>");
  }

  if (low.length) {
    blocks.push("<hr/><h3>LOW (brief)</h3><ul>");
    for (const item of low.slice(0, 15)) {
      blocks.push(
        `<li>${escapeHtml(item.shopifyOrderName)} ↔ ${escapeHtml(item.stockxOrderNumber)} (score=${item.score})</li>`
      );
    }
    blocks.push("</ul>");
  }

  return blocks.join("\n");
}

/**
 * Filter out recently emailed pairs, send one ops email for remaining mediums.
 * LOW items are attached as a brief footer when any medium is emailed (or alone if only lows — skipped).
 */
export async function emailShopifyStockxMediumCandidates(
  medium: MediumMatchEmailItem[],
  opts?: { lowBrief?: MediumMatchEmailItem[]; dryRun?: boolean }
): Promise<{
  sent: boolean;
  mediumTotal: number;
  mediumEmailed: number;
  mediumDeduped: number;
  lowBrief: number;
}> {
  const lowBrief = opts?.lowBrief ?? [];
  const empty = {
    sent: false,
    mediumTotal: medium.length,
    mediumEmailed: 0,
    mediumDeduped: 0,
    lowBrief: lowBrief.length,
  };
  if (!medium.length) return empty;

  const state = await readState();
  const fresh = filterFreshDedupeKeys(state.sent ?? {});
  const toSend: MediumMatchEmailItem[] = [];
  let deduped = 0;
  for (const item of medium) {
    const key = mediumCandidateDedupeKey(item);
    if (fresh[key]) {
      deduped += 1;
      continue;
    }
    toSend.push(item);
  }

  if (!toSend.length) {
    return { ...empty, mediumDeduped: deduped };
  }

  if (opts?.dryRun) {
    return {
      sent: false,
      mediumTotal: medium.length,
      mediumEmailed: toSend.length,
      mediumDeduped: deduped,
      lowBrief: lowBrief.length,
    };
  }

  const subject = mediumOpsEmailSubject(toSend.length, lowBrief.length);
  const text = formatMediumOpsEmailBody(toSend, { lowBrief });
  const html = formatMediumOpsEmailHtml(toSend, { lowBrief });
  const ok = await sendStockxEmail(subject, text, html);
  if (!ok) {
    console.error(
      "[SHOPIFY][STX][AUTO_LINK] medium ops email not sent — check Postmark / STOCKX_ALERT_EMAIL"
    );
    return { ...empty, mediumDeduped: deduped };
  }

  const nowIso = new Date().toISOString();
  for (const item of toSend) {
    fresh[mediumCandidateDedupeKey(item)] = nowIso;
  }
  await writeState({ sent: fresh });
  console.log(
    `[SHOPIFY][STX][AUTO_LINK] medium ops email sent count=${toSend.length} deduped=${deduped}`
  );
  return {
    sent: true,
    mediumTotal: medium.length,
    mediumEmailed: toSend.length,
    mediumDeduped: deduped,
    lowBrief: lowBrief.length,
  };
}
