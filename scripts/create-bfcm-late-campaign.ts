/**
 * Late BFCM campaigns 05 / 07 / 08. Registered profiles: 3 live BF pairs for THEIR size range. Others: 3 generic men/unisex pairs.
 * Flags: --mail=05|07|08, --preview (TEST list only), --schedule=<ISO>. Default: DRAFT, never sends.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAutomaticBfcmCatalog } from "@/bfcm/shopifyCatalog";
import { selectAutomaticOffers, type OfferVariant } from "@/bfcm/offers";

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3/emails";
const LIST_ALL = "QNJ57e";
const SEG_REGISTERED = "S3KvQm";
const SEG_EXCLUDE = "Xv2cGF";
const TEST_LIST = "W2mNct";
const MAIL = process.argv.find((a) => a.startsWith("--mail="))?.split("=")[1] ?? "";
const CFG: Record<string, { file: string; name: string; subject: string; preview: string }> = {
  "05": { file: "05_ouverture_publique", name: "05 Ouverture", subject: "Black Friday : c’est parti", preview: "−50 % et plus sur les paires en stock en Suisse." },
  "07": { file: "07_disponibilites_weekend", name: "07 Week-end / cadeaux", subject: "Pour toi, ou pour offrir", preview: "−50 % et plus, livraison 48 h* en Suisse." },
  "08": { file: "08_cloture", name: "08 Clôture", subject: "Les −50 % s’arrêtent ce soir", preview: "Dernière chance avant minuit." },
};
if (!CFG[MAIL]) throw new Error("--mail=05|07|08");
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
  `https://www.resell-lausanne.ch/pages/black-friday?size=${r}&email={{ person.email|urlencode }}${html ? "&amp;" : "&"}utm_source=email${html ? "&amp;" : "&"}utm_medium=bfcm${html ? "&amp;" : "&"}utm_campaign=bfcm_2026_${MAIL}`;

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
  const link = `${v.url}${v.url.includes("?") ? "&amp;" : "?"}utm_source=email&amp;utm_medium=bfcm&amp;utm_campaign=bfcm_2026_${MAIL}`;
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
        sel.items.map((v) => `POINTURE EU ${v.size_eu} — ${v.title}\nCHF ${v.sale_price_chf.toFixed(2)} (au lieu de CHF ${v.reference_price_chf.toFixed(2)})\nVoir la paire → (${v.url}${v.url.includes("?") ? "&" : "?"}utm_source=email&utm_medium=bfcm&utm_campaign=bfcm_2026_${MAIL})\n`).join("\n"),
    );
  });
  // Generic pairs for non-registered profiles: men/unisex only, no size claim.
  const gpool = cat.variants.filter((v) => !/\((GS|PS|TD|Kids?|Toddler)\)/i.test(v.title) && !/\(Women'?s\)/i.test(v.title));
  const gsel = selectAutomaticOffers(gpool, [], [], {}, 3);
  if (gsel.items.length < 3) throw new Error("not enough generic offers");
  console.log("generic", gsel.items.map((v) => `${v.title} ${v.sale_price_chf}`).join(" | "));
  const gcard = (v: OfferVariant) => card(v, "x").replace(/POINTURE EU [0-9.]+/, "PLUSIEURS POINTURES");
  blocks.push(`{% else %}${gsel.items.map(gcard).join("")}`);
  textBlocks.push(
    "{% else %}\n" +
      gsel.items.map((v) => `${v.title}\nCHF ${v.sale_price_chf.toFixed(2)} (au lieu de CHF ${v.reference_price_chf.toFixed(2)})\nVoir la paire → (${v.url})\n`).join("\n"),
  );
  const TEN_HTML = `<tr><td class="pad" style="padding:6px 38px 22px;background:#FFFFFF;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border:2px solid #101010;padding:16px 18px;font:400 15px/22px Arial,Helvetica,sans-serif;color:#101010;"><strong style="font-size:17px;">En plus : −10 % sur toute la boutique.</strong><br />Et −50 % et plus sur les paires en liquidation. Le −10 % s’applique automatiquement au paiement, une seule fois par année.</td></tr></table></td></tr>`;
  const TEN_TEXT = "EN PLUS : −10 % SUR TOUTE LA BOUTIQUE. Et −50 % et plus sur les paires en liquidation. Le −10 % s’applique automatiquement au paiement, une seule fois par année.\n\n";
  const rangeHtml = `${TEN_HTML}<tr><td class="pad" style="padding:0 38px 30px;background:#FFFFFF;">${blocks.join("")}{% endif %}</td></tr>`;

  const SHOP = "https://www.resell-lausanne.ch/collections/black-friday";
  const CTA_RE = /\{\{ person\|lookup:'rl_bf_2026_shop_url'\|default:'[^']*' \}\}/g;
  const COPY: [string, string][] = [];
  const copy = (s: string) => COPY.reduce((acc, [a, b]) => acc.replace(a, b), s);

  let html = copy(readFileSync(join(PACK, `${CFG[MAIL].file}.html`), "utf8"));
  const a = html.indexOf(`{% if person|lookup:'rl_bf_2026_${MAIL}_p1_ready'`);
  const p3 = html.indexOf(`{% if person|lookup:'rl_bf_2026_${MAIL}_p3_ready'`);
  const e1 = html.indexOf("{% endif %}", p3);
  const e2 = html.indexOf("{% endif %}", e1 + 5) + "{% endif %}".length;
  if (a < 0 || p3 < a) throw new Error("pair block not found");
  html = html.slice(0, a) + rangeHtml + html.slice(e2);
  html = html.replace(CTA_RE, SHOP);
  if (new RegExp(`rl_bf_2026_${MAIL}_p\\d|shop_url|rl_bf_2026_vip`).test(html)) throw new Error("legacy liquid left");
    if (!html.includes("{% unsubscribe_link %}")) throw new Error("unsubscribe missing");

  let text = copy(readFileSync(join(PACK, `${CFG[MAIL].file}.txt`), "utf8"));
  const ta = text.indexOf(`{% if person|lookup:'rl_bf_2026_${MAIL}_p1_ready'`);
  const tb = text.indexOf("Stock local.");
  if (ta < 0 || tb < ta) throw new Error("text pair block not found");
  text = (text.slice(0, ta) + TEN_TEXT + textBlocks.join("") + "{% endif %}\n\n" + text.slice(tb)).replace(CTA_RE, SHOP);
  if (new RegExp(`rl_bf_2026_${MAIL}_p\\d|shop_url`).test(text)) throw new Error("legacy liquid left (text)");

  const name = `${PREVIEW ? "[TEST] " : ""}BFCM 2026 — ${CFG[MAIL].name}`;
  const tpl = await k("templates/", "POST", { data: { type: "template", attributes: { name, editor_type: "CODE", html, text } } });
  const camp = await k("campaigns/", "POST", {
    data: {
      type: "campaign",
      attributes: {
        name,
        audiences: PREVIEW ? { included: [TEST_LIST], excluded: [] } : { included: [LIST_ALL], excluded: MAIL === "05" ? [SEG_EXCLUDE, SEG_REGISTERED] : [SEG_EXCLUDE] },
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
                    subject: CFG[MAIL].subject,
                    preview_text: CFG[MAIL].preview,
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
    console.log(`${MAIL} preview -> TEST list only`, id, j.data.attributes.status);
  } else {
    console.log("DRAFT", id);
    if (SCHEDULE) {
      await k(`campaigns/${id}`, "PATCH", { data: { type: "campaign", id, attributes: { send_strategy: { method: "static", datetime: SCHEDULE, options: { is_local: false } } } } });
      const j = await k("campaign-send-jobs/", "POST", { data: { type: "campaign-send-job", attributes: { id } } });
      console.log("SCHEDULED", SCHEDULE, j.data.attributes.status);
    }
  }
})().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
