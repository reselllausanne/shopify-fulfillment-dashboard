import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shopifyGraphQL } from "../lib/shopifyAdmin";
import { loadAutomaticBfcmCatalog } from "../bfcm/shopifyCatalog";
import {
  offerModelKey,
  selectAutomaticOffers,
  type OfferVariant,
} from "../bfcm/offers";

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3";
const KLAVIYO_BASE = "https://a.klaviyo.com/api/";
const TEST_LIST_ID = "W2mNct";
const TEST_RECIPIENT = "reselllausanne@gmail.com";
const PROFILE_ID = "01JFQX5J3VPKC70RH82NV03DSC";

const key = process.env.KLAVIYO_PRIVATE_API_KEY;
if (!key) throw new Error("KLAVIYO_PRIVATE_API_KEY is required");

const headers = {
  Authorization: `Klaviyo-API-Key ${key}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};

const MAILS = [
  ["01_selection_novembre", "On ressort les hoodies ?", "UGG, Essentials, ASICS : nos favoris pour les journées plus fraîches.", "emails"],
  ["02_invitation", "Black Friday : plus de 300 paires à −50 %", "Inscris-toi avec ta pointure : accès le 26 novembre à 19 h, 14 h avant tout le monde.", "emails"],
  ["03_apercu_et_inscription", "Jeudi à 19 h, les −50 % commencent", "Les paires de notre entrepôt à −50 % et plus. Le premier choix pour les inscrits.", "emails"],
  ["04_acces_vip", "C’est à toi : −50 % avant tout le monde", "Ton accès est ouvert. Tu as le premier choix sur les paires de notre entrepôt.", "emails"],
  ["05_ouverture_publique", "C’est parti pour les −50 %.", "Les paires sont en stock en Suisse. Livraison en 48 h*.", "emails"],
  ["06_rappel_vendredi", "Une nouvelle paire pour le week-end ?", "−50 % et plus sur les paires en stock chez nous. De quoi se faire plaisir.", "emails"],
  ["07_disponibilites_weekend", "Le cadeau qui risque de finir à tes pieds", "−50 % et plus : de quoi faire plaisir sans exploser le budget.", "emails"],
  ["08_cloture", "Les −50 % s’arrêtent ce soir", "Dernier tour avant la fin des prix Black Friday, ce soir à 23 h 59.", "emails"],
  ["confirmation_inscription_bf", "C’est bon, tu es sur la liste.", "Ton accès Black Friday et les infos utiles, juste ici.", "flows"],
] as const;

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

/** Keep the pack design. Only replace the old signup URL with the live landing. */
export function rewritePackLinks(source: string, html: boolean): string {
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

function cardProperties(
  prefix: string,
  slot: number,
  variant: OfferVariant,
  mode: "ready" | "preview",
): Record<string, string | boolean> {
  const key = `${prefix}p${slot}_`;
  const properties: Record<string, string | boolean> = {
    [key + "url"]: "https://www.resell-lausanne.ch/collections/black-friday",
    [key + "image"]: variant.image_url,
    [key + "title"]: variant.title,
    [key + "size"]: variant.size_eu,
    [key + "price"]: variant.sale_price_chf.toFixed(2),
    [key + "reference"]: variant.reference_price_chf.toFixed(2),
    [key + "ready"]: mode === "ready",
    [key + "preview_ready"]: mode === "preview",
    [key + "preview_url"]: mode === "preview" ? "https://www.resell-lausanne.ch/collections/black-friday" : "",
  };
  return properties;
}

function firstMatch(
  catalog: readonly OfferVariant[],
  pattern: RegExp,
  used: Set<string>,
): OfferVariant | undefined {
  return catalog.find((variant) => {
    const model = offerModelKey(variant);
    return pattern.test(variant.title) && !used.has(model);
  });
}

async function klaviyo(path: string, init: RequestInit = {}) {
  const response = await fetch(KLAVIYO_BASE + path, { ...init, headers });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `${init.method ?? "GET"} ${path} ${response.status}: ${body.slice(0, 1500)}`,
    );
  }
  return body ? JSON.parse(body) : {};
}

async function main() {
  const profiles = await klaviyo(
    `lists/${TEST_LIST_ID}/profiles/?page[size]=10`,
  );
  const emails = profiles.data.map(
    (profile: { attributes: { email: string } }) => profile.attributes.email,
  );
  if (
    emails.length !== 1 ||
    emails[0].toLowerCase() !== TEST_RECIPIENT.toLowerCase()
  ) {
    throw new Error(`SAFETY STOP: unexpected audience ${JSON.stringify(emails)}`);
  }

  const invitation = readFileSync(
    join(PACK, "emails/02_invitation.html"),
    "utf8",
  );
  const rewritten = rewritePackLinks(invitation, true);
  if (!rewritten.includes("size=38&amp;email={{ person.email|urlencode }}")) {
    throw new Error("Pack size link rewrite failed");
  }
  if (rewritten.includes("campaign=bf2026")) {
    throw new Error("Old signup URL still present");
  }

  const catalog = await loadAutomaticBfcmCatalog();
  const shown: string[] = [];
  const properties: Record<string, string | boolean | null> = {
    rl_bf_2026_vip: false,
  };
  for (const file of ["03", "04", "05", "06", "07", "08"]) {
    for (let slot = 1; slot <= 3; slot += 1) {
      for (const field of [
        "url",
        "image",
        "title",
        "size",
        "price",
        "reference",
        "preview_url",
      ]) {
        properties[`rl_bf_2026_${file}_p${slot}_${field}`] = null;
      }
      properties[`rl_bf_2026_${file}_p${slot}_ready`] = false;
      properties[`rl_bf_2026_${file}_p${slot}_preview_ready`] = false;
    }
  }
  const seasonal = [
    [/ugg/i, "UGG, en stock."],
    [/essential/i, "Essentials, en stock."],
    [/asics/i, "ASICS, en stock."],
  ] as const;
  const used = new Set<string>();
  seasonal.forEach(([pattern, caption], index) => {
    const variant = firstMatch(catalog.variants, pattern, used);
    if (!variant) return;
    used.add(offerModelKey(variant));
    const key = `rl_nov_2026_p${index + 1}_`;
    properties[key + "ready"] = true;
    properties[key + "image"] = variant.image_url;
    properties[key + "url"] = variant.url;
    properties[key + "title"] = variant.title;
    properties[key + "caption"] = caption;
  });

  for (const file of ["03", "04", "05", "06", "07", "08"]) {
    const selection = selectAutomaticOffers(
      catalog.variants.filter((variant) => variant.size_eu !== "38"),
      [],
      shown,
    );
    selection.items.forEach((variant) => shown.push(offerModelKey(variant)));
    selection.items.forEach((variant, index) => {
      Object.assign(
        properties,
        cardProperties(
          `rl_bf_2026_${file}_`,
          index + 1,
          variant,
          file === "03" ? "preview" : "ready",
        ),
      );
    });
  }

  const customerLookup = await shopifyGraphQL<{
    customers: {
      nodes: Array<{
        id: string;
        email: string;
        metafields: { nodes: Array<{ namespace: string; key: string; value: string }> };
      }>;
    };
  }>(
    `query ($q: String!) {
      customers(first: 5, query: $q) {
        nodes {
          id
          email
          metafields(first: 30, namespace: "custom") { nodes { namespace key value } }
        }
      }
    }`,
    { q: `email:${TEST_RECIPIENT}` },
  );
  const customer = customerLookup.data?.customers.nodes.find(
    (node) => node.email.toLowerCase() === TEST_RECIPIENT,
  );
  const sizeFields = customer?.metafields.nodes.filter((field) =>
    field.key.startsWith("bfcm_size"),
  ) ?? [];
  if (customer && sizeFields.length > 0) {
    const deleted = await shopifyGraphQL<{
      metafieldsDelete: { deletedMetafields: Array<{ key: string }> | null; userErrors: Array<{ message: string }> };
    }>(
      `mutation ($metafields: [MetafieldIdentifierInput!]!) {
        metafieldsDelete(metafields: $metafields) {
          deletedMetafields { key }
          userErrors { message }
        }
      }`,
      {
        metafields: sizeFields.map((field) => ({
          ownerId: customer.id,
          namespace: "custom",
          key: field.key,
        })),
      },
    );
    const errors = deleted.data?.metafieldsDelete.userErrors ?? [];
    if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  }
  console.log(JSON.stringify({
    shopifyCustomer: customer?.id ?? null,
    removedMetafields: sizeFields.map((field) => field.key),
  }));

  await klaviyo(`profiles/${PROFILE_ID}/`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "profile",
        id: PROFILE_ID,
        attributes: { properties },
      },
    }),
  });

  const sent: Array<{ file: string; campaignId: string; status: string }> = [];
  for (const [file, subject, preview, folder] of MAILS) {
    const html = rewritePackLinks(
      readFileSync(join(PACK, folder, `${file}.html`), "utf8"),
      true,
    );
    const text = rewritePackLinks(
      readFileSync(join(PACK, folder, `${file}.txt`), "utf8"),
      false,
    );
    const name = `[TEST PACK] ${file} — ${TEST_RECIPIENT}`;
    const template = await klaviyo("templates/", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "template",
          attributes: {
            name,
            editor_type: "CODE",
            html,
            text,
          },
        },
      }),
    });
    const message = {
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
    };
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
            "campaign-messages": { data: [message] },
          },
        },
      }),
    });
    const campaignId = campaign.data.id;
    const messageId =
      campaign.data.relationships["campaign-messages"].data[0].id;
    await klaviyo("campaign-message-assign-template", {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "campaign-message",
          id: messageId,
          relationships: {
            template: { data: { type: "template", id: template.data.id } },
          },
        },
      }),
    });
    const send = await klaviyo("campaign-send-jobs/", {
      method: "POST",
      body: JSON.stringify({
        data: { type: "campaign-send-job", id: campaignId },
      }),
    });
    sent.push({
      file,
      campaignId,
      status: send.data.attributes.status,
    });
    console.log(JSON.stringify(sent.at(-1)));
  }
  console.log(JSON.stringify({ recipient: TEST_RECIPIENT, sent }, null, 2));
}

main();
