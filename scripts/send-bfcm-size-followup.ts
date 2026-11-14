import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAutomaticBfcmCatalog } from "../bfcm/shopifyCatalog";
import {
  offerModelKey,
  selectAutomaticOffers,
  type OfferVariant,
} from "../bfcm/offers";
function landingLink(size: string | undefined, html: boolean): string {
  const amp = html ? "&amp;" : "&";
  const sizePart = size ? `size=${size}${amp}` : "";
  return (
    "https://www.resell-lausanne.ch/pages/black-friday?" +
    sizePart +
    "email={{ person.email|urlencode }}" +
    `${amp}utm_source=email${amp}utm_medium=bfcm${amp}utm_campaign=bfcm_2026_size`
  );
}

function rewritePackLinks(source: string, html: boolean): string {
  const join = html ? "&amp;" : "&";
  const pattern = new RegExp(
    "\\{\\{ person\\|lookup:'rl_bf_2026_preferences_url'\\|default:'https://www\\.resell-lausanne\\.ch/pages/black-friday\\?campaign=bf2026' \\}\\}" +
      `(?:${join})utm_source=klaviyo(?:${join})utm_medium=email(?:${join})utm_campaign=rl_bf_2026_[a-z0-9_]+` +
      `(?:(?:${join})size=([0-9.]+))?`,
    "g",
  );
  return source.replace(pattern, (_match, size: string | undefined) =>
    landingLink(size, html),
  );
}

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3";
const PROFILE_ID = "01JFQX5J3VPKC70RH82NV03DSC";
const TEST_LIST_ID = "W2mNct";
const TEST_RECIPIENT = "reselllausanne@gmail.com";
const SIZE = "40";
const COLLECTION_URL = "https://www.resell-lausanne.ch/collections/black-friday";

const key = process.env.KLAVIYO_PRIVATE_API_KEY;
if (!key) throw new Error("KLAVIYO_PRIVATE_API_KEY is required");

const headers = {
  Authorization: `Klaviyo-API-Key ${key}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};

const MAILS = [
  ["03_apercu_et_inscription", "Black Friday — jeudi à 19 h, les −50 % commencent", "Black Friday. Trois paires EU 40."],
  ["04_acces_vip", "Black Friday — c’est à toi, −50 % avant tout le monde", "Black Friday. Ton accès EU 40."],
  ["05_ouverture_publique", "Black Friday — c’est parti pour les −50 %", "Black Friday. Les paires EU 40."],
  ["06_rappel_vendredi", "Black Friday — une nouvelle paire pour le week-end ?", "Black Friday. Encore des EU 40."],
  ["07_disponibilites_weekend", "Black Friday — le cadeau qui risque de finir à tes pieds", "Black Friday. EU 40, pour toi ou pour offrir."],
  ["08_cloture", "Black Friday — les −50 % s’arrêtent ce soir", "Black Friday. Dernières paires EU 40."],
] as const;

function cardProperties(
  prefix: string,
  slot: number,
  variant: OfferVariant,
  mode: "ready" | "preview",
): Record<string, string | boolean> {
  const keyName = `${prefix}p${slot}_`;
  return {
    [keyName + "url"]: COLLECTION_URL,
    [keyName + "image"]: variant.image_url,
    [keyName + "title"]: variant.title,
    [keyName + "size"]: variant.size_eu,
    [keyName + "price"]: variant.sale_price_chf.toFixed(2),
    [keyName + "reference"]: variant.reference_price_chf.toFixed(2),
    [keyName + "ready"]: mode === "ready",
    [keyName + "preview_ready"]: mode === "preview",
    [keyName + "preview_url"]: mode === "preview" ? COLLECTION_URL : "",
  };
}

async function klaviyo(path: string, init: RequestInit = {}) {
  const response = await fetch("https://a.klaviyo.com/api/" + path, {
    ...init,
    headers,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} ${response.status}: ${body.slice(0, 800)}`);
  }
  return body ? JSON.parse(body) : {};
}

async function main() {
  const profiles = await klaviyo(`lists/${TEST_LIST_ID}/profiles/?page[size]=10`);
  const emails = profiles.data.map(
    (profile: { attributes: { email: string } }) => profile.attributes.email,
  );
  if (emails.length !== 1 || emails[0].toLowerCase() !== TEST_RECIPIENT) {
    throw new Error(`SAFETY STOP ${JSON.stringify(emails)}`);
  }

  const catalog = await loadAutomaticBfcmCatalog();
  const exact = catalog.variants.filter((variant) => variant.size_eu === SIZE);
  if (exact.length < 3) throw new Error(`Only ${exact.length} live EU ${SIZE} variants`);

  const shown: string[] = [];
  const properties: Record<string, string | boolean | string[]> = {
    rl_bf_2026_vip: true,
    rl_bf_2026_sizes_eu: [SIZE],
    rl_bf_2026_size_label: `EU ${SIZE}`,
    rl_bf_2026_size_source: "clicked_email_2026-11-13T15:00:56Z",
  };
  const chosen: Array<{ mail: string; title: string; size: string; price: string }> = [];

  for (const [file] of MAILS) {
    const number = file.slice(0, 2);
    const selection = selectAutomaticOffers(catalog.variants, [SIZE], shown);
    if (selection.items.some((item) => item.size_eu !== SIZE)) {
      throw new Error("Selector returned a non-matching size");
    }
    selection.items.forEach((variant) => shown.push(offerModelKey(variant)));
    selection.items.forEach((variant, index) => {
      Object.assign(
        properties,
        cardProperties(
          `rl_bf_2026_${number}_`,
          index + 1,
          variant,
          number === "03" ? "preview" : "ready",
        ),
      );
      chosen.push({
        mail: file,
        title: variant.title,
        size: variant.size_eu,
        price: variant.sale_price_chf.toFixed(2),
      });
    });
  }

  await klaviyo(`profiles/${PROFILE_ID}/`, {
    method: "PATCH",
    body: JSON.stringify({
      data: { type: "profile", id: PROFILE_ID, attributes: { properties } },
    }),
  });

  const sent = [];
  for (const [file, subject, preview] of MAILS) {
    const name = `[TEST PACK EU 40] ${file} — ${TEST_RECIPIENT}`;
    const template = await klaviyo("templates/", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "template",
          attributes: {
            name,
            editor_type: "CODE",
            html: rewritePackLinks(readFileSync(join(PACK, "emails", `${file}.html`), "utf8"), true),
            text: rewritePackLinks(readFileSync(join(PACK, "emails", `${file}.txt`), "utf8"), false),
          },
        },
      }),
    });
    const campaign = await klaviyo("campaigns/", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "campaign",
          attributes: {
            name,
            audiences: { included: [TEST_LIST_ID], excluded: [] },
            send_options: { use_smart_sending: false },
            send_strategy: { method: "immediate" },
            "campaign-messages": {
              data: [{
                type: "campaign-message",
                attributes: {
                  definition: {
                    channel: "email",
                    label: name,
                    content: {
                      subject,
                      preview_text: preview,
                      from_email: "Contact@resell-lausanne.ch",
                      from_label: "Resell Lausanne",
                      reply_to_email: "Contact@resell-lausanne.ch",
                    },
                  },
                },
              }],
            },
          },
        },
      }),
    });
    const campaignId = campaign.data.id;
    const messageId = campaign.data.relationships["campaign-messages"].data[0].id;
    await klaviyo("campaign-message-assign-template", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "campaign-message",
          id: messageId,
          relationships: { template: { data: { type: "template", id: template.data.id } } },
        },
      }),
    });
    const send = await klaviyo("campaign-send-jobs/", {
      method: "POST",
      body: JSON.stringify({ data: { type: "campaign-send-job", id: campaignId } }),
    });
    sent.push({ file, campaignId, status: send.data.attributes.status });
  }

  console.log(JSON.stringify({ size: SIZE, chosen, sent }, null, 2));
}

main();
