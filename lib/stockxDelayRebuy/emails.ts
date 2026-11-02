import { adminStockxCheckoutUrl } from "@/lib/stockxAutoCheckout/emailNeedsHuman";
import { formatFrDate } from "@/lib/stockxDelayRebuy/eta";
import {
  buildCustomerNarrative,
  fmtPct,
  type CustomerNarrative,
} from "@/lib/stockxDelayRebuy/narratives";
import type { DelayNarrativeKind, DelayRebuyCase } from "@/lib/stockxDelayRebuy/types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STEPS = [
  "Commande confirmée",
  "Authentification en cours",
  "Préparation expédition",
  "Expédiée via La Poste",
];

function stepHtml(activeLabel: string): string {
  return STEPS.map((label) => {
    const on = label === activeLabel;
    const color = on ? "#3ea8f4" : "#9ca3af";
    const weight = on ? 700 : 500;
    const mark = on ? "●" : "○";
    return `<div style="font-weight:${weight};color:${color};margin:4px 0">${mark} ${esc(label)}</div>`;
  }).join("");
}

/** Client-style HTML (same tone as Postmark milestone mails). */
export function buildClientPreviewHtml(
  c: DelayRebuyCase,
  narrative: CustomerNarrative
): string {
  const img = c.imageUrl
    ? `<img src="${esc(c.imageUrl)}" alt="" width="160" style="border-radius:8px;display:block;margin:16px 0" />`
    : "";
  const paras = narrative.bodyParagraphs
    .map((p) => `<p style="margin:0 0 12px;line-height:1.5;color:#111">${esc(p)}</p>`)
    .join("");

  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;padding:28px 24px;border:1px solid #e5e7eb">
    <div style="font-size:12px;color:#6b7280;margin-bottom:8px">Mise à jour automatique de ta commande. · ${esc(c.shopifyOrderName)}</div>
    <h1 style="font-size:22px;margin:0 0 16px;font-weight:700">${esc(narrative.headline)}</h1>
    ${paras}
    <div style="font-size:13px;color:#6b7280;margin:8px 0 4px">Arrivée estimée</div>
    <div style="font-size:16px;font-weight:600;margin-bottom:16px">${esc(narrative.etaLine)}</div>
    ${img}
    <div style="font-weight:600;margin-bottom:4px">${esc(c.productTitle)}</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:16px">
      ID de style ${esc(c.sku || "—")} · Taille ${esc(c.sizeEU || "—")} · ${c.saleChf.toFixed(2)} CHF
    </div>
    <div style="font-size:13px;font-weight:600;margin-bottom:6px">Statut</div>
    ${stepHtml(narrative.activeStepLabel)}
    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af">
      FAQ, delais et retours : https://www.resell-lausanne.ch/fr-fr/pages/faq<br/>
      Expéditeur: Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Suisse.
    </p>
  </div>
</body></html>`;
}

export function buildClientPreviewText(
  c: DelayRebuyCase,
  narrative: CustomerNarrative
): string {
  return [
    narrative.subject,
    "",
    ...narrative.bodyParagraphs,
    "",
    `Arrivée estimée: ${narrative.etaLine}`,
    `Produit: ${c.productTitle}`,
    `SKU: ${c.sku || "—"} · Taille: ${c.sizeEU || "—"} · ${c.saleChf.toFixed(2)} CHF`,
    `Statut actif: ${narrative.activeStepLabel}`,
    "",
    "— Resell Lausanne (preview client, pas envoyé au client)",
  ].join("\n");
}

export function buildOpsDelayText(c: DelayRebuyCase): string {
  return [
    `[OPS] RETARD détecté — ${c.shopifyOrderName}`,
    "",
    `STX: ${c.stockxOrderNumber || "—"} · status=${c.stockxStatus || "—"}`,
    `Produit: ${c.productTitle}`,
    `SKU: ${c.sku || "—"} · EU ${c.sizeEU || "—"} · sale ${c.saleChf.toFixed(2)} CHF`,
    `ETA fin: ${c.etaEnd ? formatFrDate(c.etaEnd) : "—"} · jours late: ${c.daysPastEta ?? "—"}`,
    `Lane rebuy: ${c.rebuyLane}`,
    "",
    "Action: mail client SUPPLIER_CHANGE_DELAY (preview) puis évaluer cancel/rebuy.",
    `Admin: ${adminStockxCheckoutUrl(c.shopifyOrderName, c.shopifyLineItemId)}`,
  ].join("\n");
}

export function buildOpsBuyText(c: DelayRebuyCase): string {
  const p = c.precheck;
  return [
    `[OPS] BUY / REBUY — ${c.shopifyOrderName}`,
    "",
    `STX actuel: ${c.stockxOrderNumber || "—"} (${c.stockxStatus || "—"})`,
    `Produit: ${c.productTitle}`,
    `SKU: ${c.sku || "—"} · EU ${c.sizeEU || "—"} · US ${c.sizeUS || "—"}`,
    `Sale: ${c.saleChf.toFixed(2)} CHF · Lane: ${c.rebuyLane}`,
    "",
    "—— KickDB / SupplierVariant precheck (DB, SSE stockx:ch) ——",
    `status: ${p.status}`,
    `stock: ${p.stock}`,
    `expectedBuyChf: ${p.expectedBuyChf ?? "n/a"}`,
    `marginPct: ${fmtPct(p.marginPct)}`,
    `supplierVariantId: ${p.supplierVariantId || "—"}`,
    `detail: ${p.detail}`,
    "",
    `Slug: ${c.slug || "—"}`,
    `Checkout /buy/: ${c.stockxCheckoutUrl || "—"}`,
    `PDP: ${c.stockxPdpUrl || "—"}`,
    `Admin: ${adminStockxCheckoutUrl(c.shopifyOrderName, c.shopifyLineItemId)}`,
    "",
    `ETA rebuy (${c.rebuyLane}): ${formatFrDate(c.rebuyEtaStart)} – ${formatFrDate(c.rebuyEtaEnd)}`,
    p.status === "buyable"
      ? "→ BUYABLE: prochain step = buy auto (pas encore branché)."
      : "→ PAS buyable auto: check détail / marge / stock.",
  ].join("\n");
}

export function clientMailBundle(c: DelayRebuyCase, kind: DelayNarrativeKind) {
  const narrative = buildCustomerNarrative(c, kind);
  return {
    narrative,
    subject: `[PREVIEW CLIENT] ${narrative.subject}`,
    text: buildClientPreviewText(c, narrative),
    html: buildClientPreviewHtml(c, narrative),
  };
}
