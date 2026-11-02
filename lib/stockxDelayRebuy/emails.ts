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

/**
 * Local HTML mirror of Postmark normal-ship / express-ship (product card + hero).
 * Production send uses the same Postmark TemplateAlias; this is for preview / text fallback.
 */
export function buildClientPreviewHtml(
  c: DelayRebuyCase,
  narrative: CustomerNarrative
): string {
  const activeIdx = activeStepIndexFromLabel(narrative.activeStepLabel);
  const statusNote = narrative.bodyParagraphs.join(" ");
  const title = esc(c.productTitle.replace(/\s*[-–]\s*(EU\s*)?\d+(?:[.,]\d+)?$/i, "").trim());
  const imgSrc = (c.imageUrl || "").trim();
  const img = imgSrc
    ? `<img class="prod-img" src="${esc(imgSrc)}" width="160" alt="${title}" style="border-radius:18px;height:auto;display:block;" />`
    : "";
  const heroBg = imgSrc
    ? `background:url('${esc(imgSrc)}') center/cover no-repeat;`
    : "background:#0b0b0f;";

  const steps = STEPS.map((label, i) => {
    const on = i + 1 === activeIdx;
    const cls = on ? "tracker-label-active" : "tracker-label-inactive";
    const color = on ? "#3ea8f4" : "#a0a0a0";
    const weight = on ? 700 : 400;
    return `<td align="center" width="25%" style="width:25%;vertical-align:top;">
      <img src="${stepIcon(i, on)}" alt="" width="40" style="margin:0 auto;display:block;" />
      <div class="${cls}" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:14px;padding:8px 4px 0 4px;color:${color};font-weight:${weight}">${esc(label)}</div>
    </td>`;
  }).join("");

  const year = String(new Date().getFullYear());

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
    .prod-img{width:140px!important;max-width:140px!important}
    .hero-h{height:290px!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eae8e3;">
<center style="width:100%;background:#eae8e3;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eae8e3;">
    <tr><td align="center" style="padding:22px 10px;">
      <table role="presentation" class="container" width="640" cellspacing="0" cellpadding="0" border="0" style="width:640px;max-width:640px;">
        <tr>
          <td class="px" style="padding:0 24px 10px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;color:#7b7b7b;">
            Mise à jour automatique de ta commande.
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:0 24px 14px 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="left" style="vertical-align:middle;">
                  <a href="https://resell-lausanne.ch" style="font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:34px;color:#111111;font-weight:800;text-decoration:none;">Resell-Lausanne</a>
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
          <td style="background:#d4d1c7;border-radius:18px;overflow:hidden;">
            <div class="hero-h" style="${heroBg}width:100%;height:320px;">
              <table role="presentation" width="100%" height="320" cellspacing="0" cellpadding="0" border="0" style="height:320px;">
                <tr>
                  <td style="background:rgba(0,0,0,.70);padding:38px 28px 28px 28px;vertical-align:top;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:40px;line-height:44px;font-weight:800;color:#ffffff;">${esc(narrative.headline)}</div>
                    <div style="height:8px;"></div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;color:#ffffff;font-weight:700;">Arrivée estimée:</div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;color:#ffffff;font-weight:400;">${esc(narrative.etaLine)}</div>
                    <div style="height:12px;"></div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#d4d1c7;">${esc(statusNote)}</div>
                  </td>
                </tr>
              </table>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:26px 16px 14px 16px;border-top:1px solid #d4d1c7;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${steps}</tr></table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:0 0 14px 0;border-radius:0 0 18px 18px;overflow:hidden;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr><td style="padding:18px 18px 0 18px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f6f8;border-radius:18px;">
                  <tr><td style="padding:16px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td width="160" class="stack" style="width:160px;vertical-align:top;padding-right:14px;">${img}</td>
                        <td class="stack" style="vertical-align:top;">
                          <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;color:#111111;font-weight:700;padding-bottom:10px;">${title}</div>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#6b7280;font-weight:700;">ID de style</td>
                              <td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;font-weight:700;">${esc(c.sku || "—")}</td>
                            </tr>
                            <tr>
                              <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#6b7280;font-weight:700;">Taille</td>
                              <td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;font-weight:700;">${esc(c.sizeEU || "—")}</td>
                            </tr>
                            <tr>
                              <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#6b7280;font-weight:700;">Numéro de commande</td>
                              <td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111111;font-weight:700;">${esc(c.shopifyOrderName)}</td>
                            </tr>
                            <tr>
                              <td style="padding:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#6b7280;font-weight:700;">Prix de vente</td>
                              <td align="right" style="padding:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#111111;font-weight:800;">CHF ${c.saleChf.toFixed(2)}</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td></tr>
                </table>
                <div style="height:16px;"></div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;color:#111111;font-weight:700;padding:0 2px 10px 2px;">Avant de contacter le support :</div>
                <ul style="margin:0 0 16px 18px;padding:0;font-family:Arial,Helvetica,sans-serif;color:#111111;font-size:14px;line-height:22px;">
                  <li style="margin:0 0 6px 0;">Tu recevras un e-mail automatique a chaque etape.</li>
                  <li style="margin:0 0 6px 0;">Merci d'attendre la date de livraison estimee indiquée ci-dessus.</li>
                  <li style="margin:0;">Si rien n'est livre 48h apres cette date, contacte-nous avec ton numero de commande.</li>
                </ul>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#6b7280;padding:0 2px;">
                  FAQ, delais et retours :
                  <a href="https://www.resell-lausanne.ch/fr-fr/pages/faq" style="color:#3ea8f4;text-decoration:underline;font-weight:800;">Voir la page d'aide</a>
                </div>
              </td></tr>
              <tr><td style="padding:18px 18px 0 18px;"><div style="height:1px;background:#e6e6ea;"></div></td></tr>
              <tr><td style="padding:14px 18px 18px 18px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;color:#6b7280;">
                  © ${year} Resell Lausanne. Tous droits réservés.<br/>
                  Expéditeur: Resell Lausanne, Chemin de Bas de Plan 6, 1030 Bussigny, Suisse.
                </div>
              </td></tr>
            </table>
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
