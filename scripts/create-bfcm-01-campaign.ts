/**
 * Create campaign 01 (seasonal) with STATIC cards baked in (real profiles lack rl_nov_2026_* props).
 * Default: DRAFT on Email List minus EXCLUSIONS_MARKETING_BFCM. Never sends.
 * --preview: send same content only to TEST list W2mNct.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3/emails";
const LIST_ALL = "QNJ57e";
const SEG_EXCLUDE = "Xv2cGF";
const TEST_LIST = "W2mNct";
const PREVIEW = process.argv.includes("--preview");
// Per-profile props (rl_nov_2026_p*) are set on every mailable profile -> keep Liquid, do not bake.
const LIQUID = process.argv.includes("--liquid");

const H = {
  Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};

const CARDS: Record<string, string> = {
  rl_nov_2026_p1_title: "UGG Lowmel Black (Kids)",
  rl_nov_2026_p1_caption: "UGG, en stock.",
  rl_nov_2026_p1_url: "https://www.resell-lausanne.ch/products/ugg-lowmel-black-kids?variant=54937650364802",
  rl_nov_2026_p1_image: "https://cdn.shopify.com/s/files/1/0675/8324/6625/files/img01_fa8f6e80-6d9e-45cd-969a-18a59921106d.webp?v=1782324489",
  rl_nov_2026_p2_title: "Fear of God Essentials Fleece Hoodie (FW24) Black",
  rl_nov_2026_p2_caption: "Le hoodie facile pour novembre.",
  rl_nov_2026_p2_url: "https://www.resell-lausanne.ch/products/fear-of-god-essentials-fleece-hoodie-fw24-black",
  rl_nov_2026_p2_image: "https://cdn.shopify.com/s/files/1/0675/8324/6625/files/Fear-of-God-Essentials-Kids-Fleece-Hoodie-FW24-Black_b1d38e05-a33c-4b30-82f2-3be51ece0281.webp?v=1781637004",
  rl_nov_2026_p3_title: "ASICS Gel-Lyte V Kith Leatherback",
  rl_nov_2026_p3_caption: "ASICS, en stock.",
  rl_nov_2026_p3_url: "https://www.resell-lausanne.ch/products/asics-gel-lyte-v-kith-leatherback?variant=55778266972546",
  rl_nov_2026_p3_image: "https://cdn.shopify.com/s/files/1/0675/8324/6625/files/img01_eefb3aa5-e81b-482f-abd9-f2cf5905b5ac.webp?v=1783740792",
};

const esc = (s: string) => s.replace(/&/g, "&amp;");

function bake(src: string, html: boolean): string {
  if (LIQUID) return src;
  let out = src.replace(/\{% if person\|lookup:'rl_nov_2026_p[123]_ready'[^%]*%\}/g, "");
  out = out.replace(/\{% endif %\}/g, "");
  out = out.replace(/\{\{ person\|lookup:'(rl_nov_2026_p[123]_[a-z]+)'\|default:'' \}\}/g, (_m, k: string) => {
    const v = CARDS[k];
    if (v === undefined) throw new Error(`no value for ${k}`);
    return html ? esc(v) : v;
  });
  if (/person\|lookup|\{% *(if|endif)/.test(out)) throw new Error("liquid left");
  if (!out.includes("{% unsubscribe_link %}")) throw new Error("unsubscribe missing");
  return out;
}

async function k(path: string, init: RequestInit) {
  const r = await fetch(`https://a.klaviyo.com/api/${path}`, { ...init, headers: H });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

(async () => {
  const html = bake(readFileSync(join(PACK, "01_selection_novembre.html"), "utf8"), true);
  const text = bake(readFileSync(join(PACK, "01_selection_novembre.txt"), "utf8"), false);
  const name = PREVIEW ? "[PREVIEW] BFCM 01 saison (baked) — test only" : "BFCM 2026 — 01 La sélection de saison";
  const tpl = await k("templates/", {
    method: "POST",
    body: JSON.stringify({ data: { type: "template", attributes: { name, editor_type: "CODE", html, text } } }),
  });
  const message = {
    type: "campaign-message",
    attributes: {
      definition: {
        channel: "email",
        label: name,
        content: {
          subject: "Les paires du moment pour l’hiver",
          preview_text: "Timberland, Salomon, Jordan : ce qui part le plus en ce moment.",
          from_email: "Contact@resell-lausanne.ch",
          from_label: "Resell Lausanne",
          reply_to_email: "Contact@resell-lausanne.ch",
        },
      },
    },
  };
  const audiences = PREVIEW
    ? { included: [TEST_LIST], excluded: [] }
    : { included: [LIST_ALL], excluded: [SEG_EXCLUDE] };
  const camp = await k("campaigns/", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "campaign",
        attributes: {
          name,
          audiences,
          send_options: { use_smart_sending: !PREVIEW },
          send_strategy: { method: "immediate" },
          "campaign-messages": { data: [message] },
        },
      },
    }),
  });
  const id = camp.data.id;
  const mid = camp.data.relationships["campaign-messages"].data[0].id;
  await k("campaign-message-assign-template", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "campaign-message",
        id: mid,
        relationships: { template: { data: { type: "template", id: tpl.data.id } } },
      },
    }),
  });
  if (PREVIEW) {
    const send = await k("campaign-send-jobs/", {
      method: "POST",
      body: JSON.stringify({ data: { type: "campaign-send-job", id } }),
    });
    console.log("preview sent to TEST list only", id, send.data.attributes.status);
  } else {
    console.log("DRAFT created (not sent)", id, "included", LIST_ALL, "excluded", SEG_EXCLUDE);
  }
})();
