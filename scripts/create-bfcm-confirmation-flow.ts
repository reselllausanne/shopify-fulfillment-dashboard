/**
 * Confirmation flow: trigger metric "BFCM Registered" (fired once per profile by /api/bfcm/confirm).
 * Template shows 3 trending pairs per chosen size range (range read from profile prop set by the endpoint).
 * Flow is created as DRAFT. Never sends.
 */
import { readFileSync } from "node:fs";

const PACK = "/Users/resell-lausanne/Downloads/Resell_Lausanne_BFCM_2026 3/flows";
const VIP_TS = 1795716000; // 2026-11-26 19:00 +01:00
const END_TS = 1796079599; // 2026-11-30 23:59:59 +01:00
const RANGES: Record<string, string[]> = {
  "36-37.5": ["36", "36.5", "37", "37.5"],
  "38-39.5": ["38", "38.5", "39", "39.5"],
  "40-41.5": ["40", "40.5", "41", "41.5"],
  "42-43.5": ["42", "42.5", "43", "43.5"],
  "44-46": ["44", "44.5", "45", "45.5", "46"],
};
type Pick = { seg: "m" | "w" | "u"; title: string; image: string; sizes: { size: string }[] };
const TREND: Pick[] = JSON.parse(readFileSync("/tmp/bfcm-trending.json", "utf8"));
const LINK = "https://www.resell-lausanne.ch/collections/black-friday?utm_source=email&amp;utm_medium=bfcm&amp;utm_campaign=bfcm_2026_confirm";
const H = {
  Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function pairsFor(range: string): Pick[] {
  const sizes = RANGES[range];
  const fits = (p: Pick) => p.sizes.some((s) => sizes.includes(s.size));
  const out: Pick[] = [];
  for (const seg of ["u", "m", "w"] as const) {
    const p = TREND.find((t) => t.seg === seg && fits(t) && !out.includes(t));
    if (p) out.push(p);
  }
  for (const t of TREND) if (out.length < 3 && fits(t) && !out.includes(t)) out.push(t);
  return out;
}

function card(p: Pick, label: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr><td width="40%" valign="middle" style="padding-right:16px;"><a href="${LINK}"><img src="${esc(p.image)}" width="180" alt="${esc(p.title)}" style="display:block;width:100%;max-width:180px;height:auto;border:0;" /></a></td><td width="60%" valign="middle"><p class="dm-muted" style="margin:0 0 6px;font:700 10px Arial,Helvetica,sans-serif;letter-spacing:1px;color:#666660;">POINTURE EU ${label}</p><p class="dm-ink product-name" style="margin:0 0 10px;font:700 17px/22px Arial,Helvetica,sans-serif;color:#101010;">${esc(p.title)}</p><a class="dm-ink" href="${LINK}" style="font:700 12px Arial,Helvetica,sans-serif;color:#101010;text-decoration:underline;">Voir au Black Friday&nbsp;→</a></td></tr></table>`;
}

function rangeBlocks(): string {
  return (
    Object.keys(RANGES)
      .map((r, i) => {
        const label = r.replace("-", "–");
        const cards = pairsFor(r).map((p) => card(p, label)).join("");
        return `{% ${i === 0 ? "if" : "elif"} person|lookup:'rl_bf_2026_size_range' == '${r}' %}${cards}`;
      })
      .join("") + "{% endif %}"
  );
}

function build(html: boolean): string {
  let s = readFileSync(join(PACK, html ? "confirmation_inscription_bf.html" : "confirmation_inscription_bf.txt"), "utf8");
  s = s.replace("{% if person|lookup:'rl_bf_2026_phase' == 'prepare' %}", `{% assign now_s = 'now'|date:'%s'|plus:0 %}{% if now_s < ${VIP_TS} %}`);
  s = s.replace("{% elif person|lookup:'rl_bf_2026_phase' == 'vip' %}", `{% elif now_s < ${END_TS} %}`);
  s = s.replace("{% elif person|lookup:'rl_bf_2026_phase' == 'public' %}", "{% elif now_s < 0 %}");
  s = s.replace(/Ton lien privé arrive jeudi 26 novembre à <strong>19 h<\/strong>\. Tu auras le premier choix sur les paires à <strong>−50 % et plus<\/strong>\./, "La vente s’ouvre jeudi 26 novembre à <strong>19 h</strong>. Tu auras le premier choix sur les paires à <strong>−50 % et plus</strong>, et on te prévient par mail dès l’ouverture.");
  s = s.replace("Quelques paires prévues pour le Black Friday. Le détail reste caché jusqu’au jour J.", "Quelques paires du moment dans ta pointure. Les offres Black Friday restent cachées jusqu’au jour J.");
  return s;
}
import { join } from "node:path";

async function k(path: string, body: unknown) {
  const r = await fetch(`https://a.klaviyo.com/api/${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 700)}`);
  return JSON.parse(t);
}

(async () => {
  if (process.argv.includes("--print")) {
    console.log(rangeBlocks().slice(0, 600));
    return;
  }
  let html = build(true);
  // swap the 3 per-person pair blocks (prepare branch) for range blocks
  const start = html.indexOf("{% if person|lookup:'rl_bf_2026_confirm_p1_ready'");
  const endMarker = "{% endif %}";
  const p3 = html.indexOf("{% if person|lookup:'rl_bf_2026_confirm_p3_ready'");
  const end = html.indexOf(endMarker, p3) + endMarker.length;
  if (start < 0 || p3 < 0 || end < start) throw new Error("pair blocks not found");
  html = html.slice(0, start) + rangeBlocks() + html.slice(end);
  if (/rl_bf_2026_confirm_p/.test(html)) throw new Error("per-person pair props left");
  if (!html.includes("{% unsubscribe_link %}")) throw new Error("unsubscribe missing");
  const text = build(false).replace(/\{% if person\|lookup:'rl_bf_2026_confirm_p[\s\S]*?\{% endif %\}/g, "");

  const tpl = await k("templates/", { data: { type: "template", attributes: { name: "BFCM 2026 — Confirmation inscription (flow)", editor_type: "CODE", html, text } } });
  const metrics = await (await fetch("https://a.klaviyo.com/api/metrics/", { headers: H })).json();
  const metric = metrics.data.find((m: any) => m.attributes.name === "BFCM Registered");
  if (!metric) throw new Error("metric BFCM Registered missing (fire once first)");

  const flow = await k("flows/", {
    data: {
      type: "flow",
      attributes: {
        name: "BFCM 2026 — Confirmation inscription",
        definition: {
          triggers: [{ type: "metric", id: metric.id, trigger_filter: null }],
          profile_filter: null,
          entry_action_id: "confirm-email",
          actions: [
            {
              temporary_id: "confirm-email",
              type: "send-email",
              links: { next: null },
              data: {
                message: {
                  name: "Confirmation inscription Black Friday",
                  from_email: "Contact@resell-lausanne.ch",
                  from_label: "Resell Lausanne",
                  reply_to_email: "Contact@resell-lausanne.ch",
                  cc_email: null,
                  bcc_email: null,
                  subject_line: "Black Friday — tu es sur la liste.",
                  preview_text: "Ton accès Black Friday et les infos utiles, juste ici.",
                  template_id: tpl.data.id,
                  smart_sending_enabled: false,
                  transactional: false,
                  add_tracking_params: true,
                  custom_tracking_params: null,
                  additional_filters: null,
                },
                status: "draft",
              },
            },
          ],
        },
      },
    },
  });
  console.log("flow", flow.data.id, flow.data.attributes.status, "template", tpl.data.id);
})();
