import {
  renderBf2026SizeEmailHtml,
  renderBf2026SizeEmailText,
} from "../bfcm/sizeEmail";

const KLAVIYO_BASE = "https://a.klaviyo.com/api/";
const TEST_LIST_ID = "W2mNct";
const TEST_RECIPIENT = "reselllausanne@gmail.com";
const TEMPLATE_NAME = "[BFCM 2026] 02 — Choix pointure landing privée";
const TEMPLATE_ID = "U78AYV";

const key = process.env.KLAVIYO_PRIVATE_API_KEY;
if (!key) throw new Error("KLAVIYO_PRIVATE_API_KEY is required");

const headers = {
  Authorization: `Klaviyo-API-Key ${key}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};

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

  const template = await klaviyo(`templates/${TEMPLATE_ID}/`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "template",
        id: TEMPLATE_ID,
        attributes: {
          name: TEMPLATE_NAME,
          html: renderBf2026SizeEmailHtml(),
          text: renderBf2026SizeEmailText(),
        },
      },
    }),
  });

  const campaignName = `[TEST ONLY] ${TEMPLATE_NAME} — ${TEST_RECIPIENT}`;
  const message = {
    type: "campaign-message",
    attributes: {
      definition: {
        channel: "email",
        label: campaignName,
        content: {
          subject: "Choisis ta pointure — accès Black Friday",
          preview_text: "Un clic. Ta pointure exacte. Ton accès privé.",
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
          name: campaignName,
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
          template: {
            data: { type: "template", id: template.data.id },
          },
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
    JSON.stringify(
      {
        templateId: template.data.id,
        campaignId,
        recipient: TEST_RECIPIENT,
        status: send.data.attributes.status,
      },
      null,
      2,
    ),
  );
}

main();
