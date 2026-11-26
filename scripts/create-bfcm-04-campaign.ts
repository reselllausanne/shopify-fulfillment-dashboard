/**
 * Campaign 04 (accès VIP, Thu 26 Nov 19:00). Audience = BF-registered segment; 3 live BF pairs for THEIR size range. Pairs are baked per range from the live catalog (physical stock, >=50% off).
 * Flags: --preview (send to TEST list only), --schedule=<ISO> (draft run only). Default: DRAFT, never sends.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAutomaticBfcmCatalog } from "@/bfcm/shopifyCatalog";
import { selectAutomaticOffers, type OfferVariant } from "@/bfcm/offers";

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3/emails";
const SEG_REGISTERED = "S3KvQm";
const SEG_EXCLUDE = "Xv2cGF";
const TEST_LIST = "W2mNct";
const PREVIEW = process.argv.includes("--preview");
const SCHEDULE = process.argv.find((a) => a.startsWith("--schedule="))?.split("=")[1];
const RANGES: Record<string, string[]> = {
  "36-37.5": ["36", "36.5", "37", "37.5"],
  "38-39.5": ["38", "38.5", "39", "39.5"],
  "40-41.5": ["40", "40.5", "41", "41.5"],
  "42-43.5": ["42", "42.5", "43", "43.5"],
  "44-46": ["44", "44.5", "45", "45.5", "46"],
};
const H = {
  Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const page = (r: string, html: boolean) =>
  `https://www.resell-lausanne.ch/pages/black-friday?size=${r}&email={{ person.email|urlencode }}${html ? "&amp;" : "&"}utm_source=email${html ? "&amp;" : "&"}utm_medium=bfcm${html ? "&amp;" : "&"}utm_campaign=bfcm_2026_04`;

async function k(path: string, method: string, body?: unknown): Promise<any> {
  let r: Response | undefined;
  for (let i = 0; i < 6 && !r; i++) {
    try {
      r = await fetch(`https://a.klaviyo.com/api/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    } catch {
      await new Promise((x) => setTimeout(x, 4000));
    }
  }
  if (!r) throw new Error("network");
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

function card(v: OfferVariant, range: string) {
  const link = `${v.url}${v.url.includes("?") ? "&amp;" : "?"}utm_source=email&amp;utm_medium=bfcm&amp;utm_campaign=bfcm_2026_04`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr><td width="40%" valign="middle" style="padding-right:16px;"><a href="${link}"><img src="${esc(v.image_url)}" width="180" alt="${esc(v.title)}" style="display:block;width:100%;max-width:180px;height:auto;border:0;" /></a></td><td width="60%" valign="middle"><p style="margin:0 0 6px;font:700 10px Arial,Helvetica,sans-serif;letter-spacing:1px;color:#666660;">POINTURE EU ${v.size_eu}</p><p style="margin:0 0 8px;font:700 17px/22px Arial,Helvetica,sans-serif;color:#101010;">${esc(v.title)}</p><p style="margin:0 0 10px;font:700 15px Arial,Helvetica,sans-serif;color:#101010;">CHF ${v.sale_price_chf.toFixed(2)} <span style="color:#888880;text-decoration:line-through;font-weight:400;">CHF ${v.reference_price_chf.toFixed(2)}</span></p><a href="${link}" style="font:700 12px Arial,Helvetica,sans-serif;color:#101010;text-decoration:underline;">Voir la paire&nbsp;→</a></td></tr></table>`;
}

(async () => {
  const cat = await loadAutomaticBfcmCatalog();
  console.log("catalog variants", cat.variants.length);
  const shown: string[] = [];
  const blocks: string[] = [];
  const textBlocks: string[] = [];
  Object.entries(RANGES).forEach(([r, sizes], i) => {
    // Gender unknown at signup: no kids pairs from EU 40 up, no women's pairs from EU 42 up.
    const lo = Number(sizes[0]);
    const pool = cat.variants.filter((v) => {
      if (lo >= 40 && /\((GS|PS|TD|Kids?|Toddler)\)/i.test(v.title)) return false;
      if (lo >= 40 && /\(Women'?s\)/i.test(v.title)) return false;
      return true;
    });
    const sel = selectAutomaticOffers(pool, sizes, [], {}, 3);
    console.log(r, sel.status, sel.items.map((v) => `${v.title} ${v.size_eu} ${v.sale_price_chf}`).join(" | "));
    if (sel.items.length === 0) throw new Error(`no offers for ${r}`);
    sel.items.forEach((v) => shown.push(v.variant_id));
    const kw = i === 0 ? "if" : "elif";
    blocks.push(`{% ${kw} person|lookup:'rl_bf_2026_size_range' == '${r}' %}${sel.items.map((v) => card(v, r)).join("")}`);
    textBlocks.push(
      `{% ${kw} person|lookup:'rl_bf_2026_size_range' == '${r}' %}\n` +
        sel.items.map((v) => `POINTURE EU ${v.size_eu} — ${v.title}\nCHF ${v.sale_price_chf.toFixed(2)} (au lieu de CHF ${v.reference_price_chf.toFixed(2)})\nVoir la paire → (${v.url}${v.url.includes("?") ? "&" : "?"}utm_source=email&utm_medium=bfcm&utm_campaign=bfcm_2026_04)\n`).join("\n"),
    );
  });
  const rangeHtml = `<tr><td class="pad" style="padding:0 38px 30px;background:#FFFFFF;">${blocks.join("")}{% endif %}</td></tr>`;

  const SHOP = "https://www.resell-lausanne.ch/collections/black-friday";
  const CTA_RE = /\{\{ person\|lookup:'rl_bf_2026_shop_url'\|default:'[^']*' \}\}/g;
  const COPY: [string, string][] = [
    ["TON ACCÈS EST OUVERT", "ACCÈS VIP / C’EST OUVERT"],
    ["À TOI<br />DE JOUER.", "TU PASSES<br />EN PREMIER."],
    ["À TOI\nDE JOUER.", "TU PASSES\nEN PREMIER."],
    ["PREMIER CHOIX", "14 H D’AVANCE"],
    ["On t’avait promis de passer avant tout le monde. C’est parti.", "Tu t’es inscrit avec ta pointure, merci. La liquidation est ouverte et tu as 14 h d’avance sur le reste de la liste."],
    [", et tu as le premier choix jusqu’à demain matin.", ". Les autres ne seront prévenus que demain à 9 h. Une seule paire par modèle et par pointure : premier arrivé, premier servi."],
    ["Bonne chasse.", "Voici 3 paires dans ta pointure. Bonne chasse."],
    ["J’EN PROFITE EN PREMIER", "ACTIVER MON ACCÈS"],
    ["J’EN PROFITE EN PREMIER", "ACTIVER MON ACCÈS"],
  ];
  const copy = (s: string) => COPY.reduce((acc, [a, b]) => acc.replace(a, b), s);

  let html = copy(readFileSync(join(PACK, "04_acces_vip.html"), "utf8"));
  const a = html.indexOf("{% if person|lookup:'rl_bf_2026_04_p1_ready'");
  const p3 = html.indexOf("{% if person|lookup:'rl_bf_2026_04_p3_ready'");
  const e1 = html.indexOf("{% endif %}", p3);
  const e2 = html.indexOf("{% endif %}", e1 + 5) + "{% endif %}".length;
  if (a < 0 || p3 < a) throw new Error("pair block not found");
  html = html.slice(0, a) + rangeHtml + html.slice(e2);
  html = html.replace(CTA_RE, SHOP);
  if (/rl_bf_2026_04_p\d|shop_url|rl_bf_2026_vip/.test(html)) throw new Error("legacy liquid left");
  if (/promis de passer avant|premier choix jusqu|DE JOUER/.test(html)) throw new Error("old copy left");
  if (!html.includes("{% unsubscribe_link %}")) throw new Error("unsubscribe missing");

  let text = copy(readFileSync(join(PACK, "04_acces_vip.txt"), "utf8"));
  const ta = text.indexOf("{% if person|lookup:'rl_bf_2026_04_p1_ready'");
  const tb = text.indexOf("Stock local.");
  if (ta < 0 || tb < ta) throw new Error("text pair block not found");
  text = (text.slice(0, ta) + textBlocks.join("") + "{% endif %}\n\n" + text.slice(tb)).replace(CTA_RE, SHOP);
  if (/rl_bf_2026_04_p\d|shop_url/.test(text)) throw new Error("legacy liquid left (text)");

  const name = PREVIEW ? "[TEST] BFCM 2026 — 04 Accès VIP par pointure" : "BFCM 2026 — 04 Accès VIP par pointure";
  const tpl = await k("templates/", "POST", { data: { type: "template", attributes: { name, editor_type: "CODE", html, text } } });
  const camp = await k("campaigns/", "POST", {
    data: {
      type: "campaign",
      attributes: {
        name,
        audiences: PREVIEW ? { included: [TEST_LIST], excluded: [] } : { included: [SEG_REGISTERED], excluded: [SEG_EXCLUDE] },
        send_options: { use_smart_sending: !PREVIEW },
        send_strategy: { method: "immediate" },
        "campaign-messages": {
          data: [
            {
              type: "campaign-message",
              attributes: {
                definition: {
                  channel: "email",
                  label: name,
                  content: {
                    subject: "EARLY ACCESS 🔓 Black Friday : c’est ouvert",
                    preview_text: "−50 % et plus. 14 h d’avance, tes paires dans ta pointure.",
                    from_email: "Contact@resell-lausanne.ch",
                    from_label: "Resell Lausanne",
                    reply_to_email: "Contact@resell-lausanne.ch",
                  },
                },
              },
            },
          ],
        },
      },
    },
  });
  const id = camp.data.id;
  const mid = camp.data.relationships["campaign-messages"].data[0].id;
  await k("campaign-message-assign-template", "POST", {
    data: { type: "campaign-message", id: mid, relationships: { template: { data: { type: "template", id: tpl.data.id } } } },
  });
  if (PREVIEW) {
    const j = await k("campaign-send-jobs/", "POST", { data: { type: "campaign-send-job", id } });
    console.log("04 preview -> TEST list only", id, j.data.attributes.status);
  } else {
    console.log("DRAFT", id);
    if (SCHEDULE) {
      await k(`campaigns/${id}`, "PATCH", { data: { type: "campaign", id, attributes: { send_strategy: { method: "static", datetime: SCHEDULE, options: { is_local: false } } } } });
      const j = await k("campaign-send-jobs/", "POST", { data: { type: "campaign-send-job", attributes: { id } } });
      console.log("SCHEDULED", SCHEDULE, j.data.attributes.status);
    }
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
