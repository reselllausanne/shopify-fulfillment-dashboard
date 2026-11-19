/** Create campaign 02 (invitation + size capture). Audience: Email List minus exclusions minus BF-registered. DRAFT; --schedule=<ISO> queues it. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3/emails";
const LIST_ALL = "QNJ57e";
const SEG_EXCLUDE = "Xv2cGF";
const SCHEDULE = process.argv.find((a) => a.startsWith("--schedule="))?.split("=")[1];
const H = {
  Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};

async function k(path: string, method: string, body?: unknown): Promise<any> {
  let r: Response | undefined;
  for (let i = 0; i < 6 && !r; i++) {
    try {
      r = await fetch(`https://a.klaviyo.com/api/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    } catch {
      await new Promise((x) => setTimeout(x, 4000)); // connect timeout: never sent, safe to retry
    }
  }
  if (!r) throw new Error("network");
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

const landing = (html: boolean) => {
  const j = html ? "&amp;" : "&";
  return `https://www.resell-lausanne.ch/pages/black-friday?email={{ person.email|urlencode }}${j}utm_source=email${j}utm_medium=bfcm${j}utm_campaign=bfcm_2026_size`;
};
function rewrite(src: string, html: boolean) {
  const j = html ? "&amp;" : "&";
  const re = new RegExp(
    "\\{\\{ person\\|lookup:'rl_bf_2026_preferences_url'\\|default:'https://www\\.resell-lausanne\\.ch/pages/black-friday\\?campaign=bf2026' \\}\\}" +
      `(?:${j})utm_source=klaviyo(?:${j})utm_medium=email(?:${j})utm_campaign=rl_bf_2026_[a-z0-9_]+(?:(?:${j})size=([0-9.]+))?`,
    "g",
  );
  return src.replace(re, () => landing(html));
}

(async () => {
  const html = rewrite(readFileSync(join(PACK, "02_invitation.html"), "utf8"), true);
  const text = rewrite(readFileSync(join(PACK, "02_invitation.txt"), "utf8"), false);
  if (/preferences_url/.test(html)) throw new Error("old links left");
  if (!html.includes("{% unsubscribe_link %}")) throw new Error("unsubscribe missing");

  const seg = await k("segments/", "POST", {
    data: {
      type: "segment",
      attributes: {
        name: "BFCM 2026 — inscrits (taille reçue)",
        definition: {
          condition_groups: [
            {
              conditions: [
                { type: "profile-property", property: "properties['rl_bf_2026_registered']", filter: { type: "boolean", operator: "equals", value: true } },
              ],
            },
          ],
        },
      },
    },
  });
  const segReg = seg.data.id;

  const name = "BFCM 2026 — 02 Invitation + pointure";
  const tpl = await k("templates/", "POST", { data: { type: "template", attributes: { name, editor_type: "CODE", html, text } } });
  const camp = await k("campaigns/", "POST", {
    data: {
      type: "campaign",
      attributes: {
        name,
        audiences: { included: [LIST_ALL], excluded: [SEG_EXCLUDE, segReg] },
        send_options: { use_smart_sending: true },
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
                    subject: "Black Friday : plus de 300 paires à −50 %",
                    preview_text: "Inscris-toi avec ta pointure : accès le 26 novembre à 19 h.",
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
  console.log("DRAFT", id, "excl", SEG_EXCLUDE, segReg);
  if (SCHEDULE) {
    await k(`campaigns/${id}`, "PATCH", {
      data: { type: "campaign", id, attributes: { send_strategy: { method: "static", datetime: SCHEDULE, options: { is_local: false } } } },
    });
    const j = await k("campaign-send-jobs/", "POST", { data: { type: "campaign-send-job", attributes: { id } } });
    console.log("SCHEDULED", SCHEDULE, j.data.attributes.status);
  }
})();
