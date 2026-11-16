import { readFileSync } from "node:fs";
import { loadAutomaticBfcmCatalog } from "../bfcm/shopifyCatalog";
import { selectAutomaticOffers } from "../bfcm/offers";

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3";
const PROFILE_ID = "01JFQX5J3VPKC70RH82NV03DSC";
const TEST_LIST_ID = "W2mNct";
const TEST_RECIPIENT = "reselllausanne@gmail.com";
const key = process.env.KLAVIYO_PRIVATE_API_KEY;
if (!key) throw new Error("KLAVIYO_PRIVATE_API_KEY is required");

const headers = {
  Authorization: `Klaviyo-API-Key ${key}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};

function landingLink(size: string | undefined, html: boolean): string {
  const join = html ? "&amp;" : "&";
  return (
    "https://www.resell-lausanne.ch/pages/black-friday?" +
    (size ? `size=${size}${join}` : "") +
    "email={{ person.email|urlencode }}" +
    `${join}utm_source=email${join}utm_medium=bfcm${join}utm_campaign=bfcm_2026_size`
  );
}

function rewrite(source: string, html: boolean): string {
  const join = html ? "&amp;" : "&";
  const pattern = new RegExp(
    "\\{\\{ person\\|lookup:'rl_bf_2026_(?:preferences|shop)_url'\\|default:'https://www\\.resell-lausanne\\.ch/(?:pages|collections)/black-friday\\?campaign=bf2026(?:-test)?' \\}\\}" +
      `(?:${join})utm_source=klaviyo(?:${join})utm_medium=email(?:${join})utm_campaign=rl_bf_2026_[a-z0-9_]+` +
      `(?:(?:${join})size=([0-9.]+))?`,
    "g",
  );
  return source.replace(pattern, (_match, size: string | undefined) =>
    landingLink(size, html),
  );
}

async function klaviyo(path: string, init: RequestInit = {}) {
  const response = await fetch("https://a.klaviyo.com/api/" + path, {
    ...init,
    headers,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${body.slice(0, 500)}`);
  }
  return body ? JSON.parse(body) : {};
}

async function main() {
  const members = await klaviyo(
    `lists/${TEST_LIST_ID}/profiles/?page[size]=10`,
  );
  const emails = members.data.map(
    (profile: { attributes: { email: string } }) => profile.attributes.email,
  );
  if (emails.length !== 1 || emails[0].toLowerCase() !== TEST_RECIPIENT) {
    throw new Error(`SAFETY STOP ${JSON.stringify(emails)}`);
  }

  const catalog = await loadAutomaticBfcmCatalog();
  const pairs = selectAutomaticOffers(catalog.variants, ["40"], [], {}, 3);
  if (pairs.items.length === 0 || pairs.items.some((item) => item.size_eu !== "40")) {
    throw new Error("No exact EU 40 examples");
  }
  const confirmPairs: Record<string, string | boolean> = {};
  for (let slot = 1; slot <= 3; slot += 1) {
    const variant = pairs.items[slot - 1];
    const key = `rl_bf_2026_confirm_p${slot}_`;
    confirmPairs[key + "ready"] = Boolean(variant);
    confirmPairs[key + "image"] = variant?.image_url ?? "";
    confirmPairs[key + "title"] = variant?.title ?? "";
    confirmPairs[key + "size"] = variant?.size_eu ?? "";
  }

  await klaviyo(`profiles/${PROFILE_ID}/`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "profile",
        id: PROFILE_ID,
        attributes: {
          properties: {
            rl_bf_2026_phase: "prepare",
            rl_bf_2026_size_label: "EU 40",
            rl_bf_2026_sizes_eu: ["40"],
            rl_bf_2026_vip: true,
            ...confirmPairs,
          },
        },
      },
    }),
  });

  const html = rewrite(
    readFileSync(`${PACK}/flows/confirmation_inscription_bf.html`, "utf8"),
    true,
  );
  const text = rewrite(
    readFileSync(`${PACK}/flows/confirmation_inscription_bf.txt`, "utf8"),
    false,
  );
  if (html.includes("MA POINTURE")) {
    throw new Error("Size button is still in the confirmation");
  }
  if (html.includes("/pages/black-friday?size=")) {
    throw new Error("Pair links still open the size confirmation page");
  }
  if (!html.includes("/collections/black-friday")) {
    throw new Error("Pair links do not open the Black Friday collection");
  }

  const name = `[TEST PACK EU 40] confirmation_inscription_bf — ${TEST_RECIPIENT}`;
  const template = await klaviyo("templates/", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "template",
        attributes: { name, editor_type: "CODE", html, text },
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
            data: [
              {
                type: "campaign-message",
                attributes: {
                  definition: {
                    channel: "email",
                    label: name,
                    content: {
                      subject: "Black Friday — c’est bon, tu es sur la liste.",
                      preview_text: "EU 40. Quelques paires, le détail reste caché.",
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
  console.log(
    JSON.stringify({
      campaignId,
      status: send.data.attributes.status,
      size: "EU 40",
      pairs: pairs.items.map((item) => ({ title: item.title, size: item.size_eu })),
    }),
  );
}

main();
