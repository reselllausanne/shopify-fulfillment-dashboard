import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3/emails";
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

const MAILS = [
  ["03_apercu_et_inscription", "Black Friday — jeudi à 19 h, les −50 % commencent", "Black Friday. Trois paires EU 40."],
  ["04_acces_vip", "Black Friday — c’est à toi, −50 % avant tout le monde", "Black Friday. Ton accès EU 40."],
  ["06_rappel_vendredi", "Black Friday — une nouvelle paire pour le week-end ?", "Black Friday. Encore des EU 40."],
  ["07_disponibilites_weekend", "Black Friday — le cadeau qui risque de finir à tes pieds", "Black Friday. EU 40, pour toi ou pour offrir."],
] as const;

function rewrite(source: string, html: boolean): string {
  const join = html ? "&amp;" : "&";
  const pattern = new RegExp(
    "\\{\\{ person\\|lookup:'rl_bf_2026_preferences_url'\\|default:'https://www\\.resell-lausanne\\.ch/pages/black-friday\\?campaign=bf2026' \\}\\}" +
      `(?:${join})utm_source=klaviyo(?:${join})utm_medium=email(?:${join})utm_campaign=rl_bf_2026_[a-z0-9_]+` +
      `(?:(?:${join})size=([0-9.]+))?`,
    "g",
  );
  return source.replace(pattern, (_match, size: string | undefined) => {
    const sizePart = size ? `size=${size}${join}` : "";
    return (
      "https://www.resell-lausanne.ch/pages/black-friday?" +
      sizePart +
      "email={{ person.email|urlencode }}" +
      `${join}utm_source=email${join}utm_medium=bfcm${join}utm_campaign=bfcm_2026_size`
    );
  });
}

async function klaviyo(path: string, init: RequestInit = {}) {
  const response = await fetch("https://a.klaviyo.com/api/" + path, {
    ...init,
    headers,
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${body.slice(0, 400)}`);
  return body ? JSON.parse(body) : {};
}

async function main() {
  const members = await klaviyo(`lists/${TEST_LIST_ID}/profiles/?page[size]=10`);
  const emails = members.data.map(
    (profile: { attributes: { email: string } }) => profile.attributes.email,
  );
  if (emails.length !== 1 || emails[0].toLowerCase() !== TEST_RECIPIENT) {
    throw new Error(`SAFETY STOP ${JSON.stringify(emails)}`);
  }

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
            html: rewrite(readFileSync(join(PACK, `${file}.html`), "utf8"), true),
            text: rewrite(readFileSync(join(PACK, `${file}.txt`), "utf8"), false),
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
    console.log(JSON.stringify({ file, subject, status: send.data.attributes.status }));
  }
}

main();
