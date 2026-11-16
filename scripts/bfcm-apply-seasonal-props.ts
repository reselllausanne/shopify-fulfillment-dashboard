/**
 * Set rl_nov_2026_p1..p3_* on mailable profiles (properties only, no consent change).
 * Cards = trending pairs not in warehouse stock, not sale. Click -> Black Friday collection (never product).
 * Gender from order history (Women's / kids -> women side). Size used only when "sure"
 * (>=2 adult shoe orders, >=75% same size) and never mentioned in the mail.
 * Usage: tsx scripts/bfcm-apply-seasonal-props.ts [--apply]
 */
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const H = {
  Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
  accept: "application/vnd.api+json",
  "content-type": "application/vnd.api+json",
  revision: "2025-10-15",
};
type Pick = { handle: string; seg: "m" | "w" | "u" | "h"; title: string; image: string; sizes: { id: string; size: string }[] };
const TREND: Pick[] = JSON.parse(readFileSync("/tmp/bfcm-trending.json", "utf8"));
const CUST: Record<string, { gender: "m" | "w" | "u"; sureSize: string | null }> = JSON.parse(readFileSync("/tmp/bfcm-sizes.json", "utf8"));
const LINK = "https://www.resell-lausanne.ch/collections/black-friday?utm_source=klaviyo&utm_medium=email&utm_campaign=rl_nov_2026_saison";

const by = (h: string) => {
  const p = TREND.find((t) => t.handle === h);
  if (!p) throw new Error(`trend pick missing: ${h}`);
  return p;
};
const TIMBERLAND = by("timberland-6-inch-premium-waterproof-wheat");
const HOODIE = by("fear-of-god-essentials-fleece-hoodie-black");
const UGG_TASMAN = by("ugg-tasman-ii-slipper-black");
const UGG_MINI_W = by("ugg-classic-ultra-mini-chestnut-w");
const FALLBACK = by("salomon-xt-6-black-coffee-burro-bitter-chocolate");

// Winter bestsellers: slot 1 boot, slot 2 hoodie, slot 3 UGG / second boot. Women: UGG mini first.
function choose(gender: "m" | "w" | "u", size: string | null): Pick[] {
  const slots = gender === "w" ? [UGG_MINI_W, HOODIE, TIMBERLAND] : [TIMBERLAND, HOODIE, UGG_TASMAN];
  const fits = (t: Pick) => t.seg === "h" || !size || t.sizes.some((s) => s.size === size);
  return slots.map((t) => (fits(t) ? t : FALLBACK));
}

async function k(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, headers: H });
  if (r.status === 429) { await new Promise((x) => setTimeout(x, 3000)); return k(url, init); }
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}
async function members(u: string) {
  const m = new Map<string, string>();
  while (u) {
    const j = await k(u);
    for (const p of j.data ?? []) m.set((p.attributes.email || "").toLowerCase(), p.id);
    u = j.links?.next;
  }
  return m;
}

(async () => {
  const all = await members("https://a.klaviyo.com/api/lists/QNJ57e/profiles/?page[size]=100&fields[profile]=email");
  const ex = await members("https://a.klaviyo.com/api/segments/Xv2cGF/profiles/?page[size]=100&fields[profile]=email");
  const stats: Record<string, number> = { audience: 0, m: 0, w: 0, u: 0, sureSize: 0 };
  let done = 0;
  for (const [email, id] of all) {
    if (ex.has(email) || !email) continue;
    stats.audience++;
    const c = CUST[email];
    const gender = c?.gender ?? "u";
    const size = c?.sureSize ?? null;
    stats[gender]++;
    if (size) stats.sureSize++;
    const picks = choose(gender, size);
    const props: Record<string, unknown> = {};
    picks.forEach((p, i) => {
      const n = i + 1;
      props[`rl_nov_2026_p${n}_ready`] = true;
      props[`rl_nov_2026_p${n}_title`] = p.title;
      props[`rl_nov_2026_p${n}_caption`] = "Parmi les plus vendues cet hiver.";
      props[`rl_nov_2026_p${n}_url`] = LINK;
      props[`rl_nov_2026_p${n}_image`] = p.image;
    });
    if (APPLY) {
      await k(`https://a.klaviyo.com/api/profiles/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({ data: { type: "profile", id, attributes: { properties: props } } }),
      });
      if (++done % 100 === 0) console.log("patched", done);
    }
  }
  console.log(JSON.stringify({ apply: APPLY, ...stats, trendPairs: TREND.length }));
})();
