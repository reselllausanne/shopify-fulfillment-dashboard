/** Send pack mail 02 (size capture, 5 range buttons) ONLY to the TEST list W2mNct. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3/emails";
const TEST_LIST = "W2mNct";
const H = {
  Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};

function landing(html: boolean) {
  const j = html ? "&amp;" : "&";
  return `https://www.resell-lausanne.ch/pages/black-friday?email={{ person.email|urlencode }}${j}utm_source=email${j}utm_medium=bfcm${j}utm_campaign=bfcm_2026_size`;
}
function rewrite(src: string, html: boolean) {
  const j = html ? "&amp;" : "&";
  const re = new RegExp(
    "\\{\\{ person\\|lookup:'rl_bf_2026_preferences_url'\\|default:'https://www\\.resell-lausanne\\.ch/pages/black-friday\\?campaign=bf2026' \\}\\}" +
      `(?:${j})utm_source=klaviyo(?:${j})utm_medium=email(?:${j})utm_campaign=rl_bf_2026_[a-z0-9_]+(?:(?:${j})size=([0-9.]+))?`,
    "g",
  );
  return src.replace(re, () => landing(html));
}

async function k(path: string, body: unknown): Promise<any> {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(`https://a.klaviyo.com/api/${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
      const t = await r.text();
      if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 400)}`);
      return t ? JSON.parse(t) : {};
    } catch (e: any) {
      if (!/fetch failed/.test(String(e?.message))) throw e;
      await new Promise((x) => setTimeout(x, 4000));
    }
  }
  throw new Error("network");
}

(async () => {
  const html = rewrite(readFileSync(join(PACK, "02_invitation.html"), "utf8"), true);
  const text = rewrite(readFileSync(join(PACK, "02_invitation.txt"), "utf8"), false);
  if (/preferences_url/.test(html)) throw new Error("old preferences links left");
  const name = "[TEST] BFCM 02 capture pointure — reselllausanne@gmail.com";
  const tpl = await k("templates/", { data: { type: "template", attributes: { name, editor_type: "CODE", html, text } } });
  const camp = await k("campaigns/", {
    data: {
      type: "campaign",
      attributes: {
        name,
        audiences: { included: [TEST_LIST], excluded: [] },
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
  await k("campaign-message-assign-template", {
    data: { type: "campaign-message", id: mid, relationships: { template: { data: { type: "template", id: tpl.data.id } } } },
  });
  const send = await k("campaign-send-jobs/", { data: { type: "campaign-send-job", id } });
  console.log("02 sent to TEST list only", id, send.data.attributes.status);
})();
