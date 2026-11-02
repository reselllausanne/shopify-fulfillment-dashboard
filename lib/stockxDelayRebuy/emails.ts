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

const STEP_ICONS = [
  "https://stockx-assets.imgix.net/emails/transactional/buyer-icons/b051ordered-icon2.png?dpr=2&w=100&fill=solid&fill-color=COLOR&fit=fill&border=1%2CCOLOR&border-radius=50%2C50%2C50%2C50&border-radius-inner=50%2C50%2C50%2C50",
  "https://stockx-assets.imgix.net/emails/transactional/buyer-icons/b052shippedToStockX-icon2.png?dpr=2&w=100&fill=solid&fill-color=COLOR&fit=fill&border=1%2CCOLOR&border-radius=50%2C50%2C50%2C50&border-radius-inner=50%2C50%2C50%2C50",
  "https://stockx-assets.imgix.net/emails/transactional/buyer-icons/b052shippedToStockX-icon2.png?dpr=2&w=100&fill=solid&fill-color=COLOR&fit=fill&border=1%2CCOLOR&border-radius=50%2C50%2C50%2C50&border-radius-inner=50%2C50%2C50%2C50",
  "https://stockx-assets.imgix.net/emails/transactional/buyer-icons/b053shippedToBuyer3.png?dpr=2&w=100&fill=solid&fill-color=COLOR&fit=fill&border=1%2CCOLOR&border-radius=50%2C50%2C50%2C50&border-radius-inner=50%2C50%2C50%2C50",
];

export function activeStepIndexFromLabel(label: string): 1 | 2 | 3 | 4 {
  const idx = STEPS.indexOf(label);
  if (idx < 0) return 1;
  return (idx + 1) as 1 | 2 | 3 | 4;
}

function stepIcon(i: number, active: boolean): string {
  const color = active ? "3ea8f4" : "a0a0a0";
  return STEP_ICONS[i]!.replace(/COLOR/g, color);
}

function summaryRow(label: string, value: string, last = false): string {
  const border = last ? "none" : "1px solid #e6e6ea";
  const pad = last ? "12px 0 2px 0" : "12px 0";
  return `<tr>
    <td style="padding:${pad};border-bottom:${border};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#6b7280;font-weight:400;vertical-align:middle;">${esc(label)}</td>
    <td align="right" style="padding:${pad};border-bottom:${border};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;color:#111111;font-weight:600;vertical-align:middle;">${esc(value)}</td>
  </tr>`;
}

/**
 * Customer HTML for delay / cancel-rebuy.
 * Visual system from normal-ship.html / express-ship.html (640px, beige canvas,
 * tracker icons, #f6f6f8 summary, footer). Information placement follows the
 * purchase-confirm hierarchy: greeting, one-line status, ETA band, product
 * image in the summary, short body underneath. The apology is not painted
 * over the product photo.
 */
export function buildClientPreviewHtml(
  c: DelayRebuyCase,
  narrative: CustomerNarrative
): string {
  const activeIdx = activeStepIndexFromLabel(narrative.activeStepLabel);
  const title = esc(c.productTitle.replace(/\s*[-–]\s*(EU\s*)?\d+(?:[.,]\d+)?$/i, "").trim());
  const imgSrc = (c.imageUrl || "").trim();
  const img = imgSrc
    ? `<td width="200" class="stack" style="width:200px;vertical-align:top;padding-right:18px;">
        <img class="prod-img" src="${esc(imgSrc)}" width="200" alt="${title}" style="width:200px;max-width:200px;height:auto;border-radius:8px;background:#ffffff;border:1px solid #e6e6ea;display:block;" />
      </td>`
    : "";

  const steps = STEPS.map((label, i) => {
    const on = i + 1 === activeIdx;
    const color = on ? "#3ea8f4" : "#a0a0a0";
    const weight = on ? 700 : 400;
    return `<td align="center" width="25%" style="width:25%;vertical-align:top;">
      <img src="${stepIcon(i, on)}" alt="" width="40" style="margin:0 auto;display:block;" />
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:14px;padding:8px 4px 0 4px;color:${color};font-weight:${weight}">${esc(label)}</div>
    </td>`;
  }).join("");

  const body = narrative.bodyParagraphs
    .map(
      (p, i) =>
        `<p style="margin:0 0 ${i === narrative.bodyParagraphs.length - 1 ? "0" : "12px"} 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#111111;">${esc(p)}</p>`
    )
    .join("");

  const year = String(new Date().getFullYear());
  const support = (process.env.SUPPORT_EMAIL || process.env.POSTMARK_FROM_EMAIL || "").trim();
  const helpLine = support
    ? `<br/>Besoin d'aide ? <a href="mailto:${esc(support)}" style="color:#3ea8f4;text-decoration:underline;font-weight:700;">${esc(support)}</a>`
    : "";

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(narrative.subject)}</title>
<style type="text/css">
  html,body{margin:0!important;padding:0!important}
  img{border:0;outline:none;text-decoration:none;display:block}
  @media screen and (max-width:680px){
    .container{width:100%!important}
    .px{padding-left:16px!important;padding-right:16px!important}
    .stack{display:block!important;width:100%!important}
    .prod-img{width:180px!important;max-width:180px!important;margin:0 0 14px 0!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eae8e3;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(narrative.statusLine)} ${esc(narrative.etaLine)}</div>
<center style="width:100%;background:#eae8e3;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eae8e3;">
    <tr><td align="center" style="padding:22px 10px;">
      <table role="presentation" class="container" width="640" cellspacing="0" cellpadding="0" border="0" style="width:640px;max-width:640px;">
        <tr>
          <td class="px" style="padding:0 24px 10px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;color:#7b7b7b;">
            Mise à jour de ta commande.
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:0 24px 14px 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="left" style="vertical-align:middle;">
                  <a href="https://www.resell-lausanne.ch" style="font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:32px;color:#111111;font-weight:800;text-decoration:none;">Resell-Lausanne</a>
                </td>
                <td align="right" style="vertical-align:middle;">
                  <span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:18px;color:#6b7280;">
                    Commande <strong style="color:#111111;">${esc(c.shopifyOrderName)}</strong>
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-radius:18px 18px 0 0;padding:28px 28px 8px 28px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;color:#111111;">${esc(narrative.greeting)}</div>
            <div style="height:14px;line-height:14px;font-size:14px;">&nbsp;</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:34px;font-weight:800;color:#111111;">${esc(narrative.headline)}</div>
            <div style="height:8px;line-height:8px;font-size:8px;">&nbsp;</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#374151;">${esc(narrative.statusLine)}</div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:16px 18px 6px 18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f6f8;border-radius:12px;">
              <tr>
                <td style="padding:16px 18px;">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:14px;letter-spacing:.4px;text-transform:uppercase;color:#6b7280;font-weight:700;">Arrivée estimée</div>
                  <div style="height:6px;line-height:6px;font-size:6px;">&nbsp;</div>
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;color:#111111;font-weight:700;">${esc(narrative.etaLine)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:22px 16px 8px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${steps}</tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:8px 18px 0 18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f6f8;border-radius:12px;">
              <tr><td style="padding:18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    ${img}
                    <td class="stack" style="vertical-align:top;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;color:#111111;font-weight:700;padding-bottom:8px;">${title}</div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        ${summaryRow("ID de style", c.sku || "—")}
                        ${summaryRow("Taille", c.sizeEU || "—")}
                        ${summaryRow("Numéro de commande", c.shopifyOrderName)}
                        ${summaryRow("Livraison", narrative.shippingLabel)}
                        ${summaryRow("Prix", `CHF ${c.saleChf.toFixed(2)}`, true)}
                      </table>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:18px 28px 8px 28px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:8px 28px 0 28px;">
            <div style="height:1px;background:#e6e6ea;line-height:1px;font-size:1px;">&nbsp;</div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:16px 28px 8px 28px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;color:#111111;font-weight:700;padding-bottom:8px;">Et ensuite</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#111111;">Un e-mail automatique part à chaque étape.</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#111111;">La date de livraison estimée figure ci-dessus.</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:#111111;">Si rien n'est livré 48 h après cette date, contacte-nous avec ton numéro de commande.</div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:14px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#6b7280;">
            FAQ, délais et retours :
            <a href="https://www.resell-lausanne.ch/fr-fr/pages/faq" style="color:#3ea8f4;text-decoration:underline;font-weight:700;">Voir la page d'aide</a>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border-radius:0 0 18px 18px;padding:8px 28px 22px 28px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#6b7280;">
              © ${year} Resell Lausanne. Tous droits réservés.<br/>
              Expéditeur : Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Suisse.${helpLine}
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</center>
</body></html>`;
}

export function buildClientPreviewText(
  c: DelayRebuyCase,
  narrative: CustomerNarrative,
  opts?: { forCustomer?: boolean }
): string {
  return [
    narrative.subject,
    "",
    narrative.greeting,
    narrative.headline,
    narrative.statusLine,
    "",
    `Arrivée estimée : ${narrative.etaLine}`,
    "",
    ...narrative.bodyParagraphs,
    "",
    `Produit : ${c.productTitle}`,
    `ID de style : ${c.sku || "—"}`,
    `Taille : ${c.sizeEU || "—"}`,
    `Commande : ${c.shopifyOrderName}`,
    `Livraison : ${narrative.shippingLabel}`,
    `Prix : ${c.saleChf.toFixed(2)} CHF`,
    `Statut : ${narrative.activeStepLabel}`,
    "",
    opts?.forCustomer
      ? "— Resell Lausanne"
      : "— Resell Lausanne (preview client, pas envoyé au client)",
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
