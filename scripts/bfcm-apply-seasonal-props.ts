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
type Pick = { handle: string; seg: "m" | "w" | "u"; title: string; image: string; sizes: { id: string; size: string }[] };
const TREND: Pick[] = JSON.parse(readFileSync("/tmp/bfcm-trending.json", "utf8"));
const CUST: Record<string, { gender: "m" | "w" | "u"; sureSize: string | null }> = JSON.parse(readFileSync("/tmp/bfcm-sizes.json", "utf8"));
const LINK = "https://www.resell-lausanne.ch/collections/black-friday?utm_source=klaviyo&utm_medium=email&utm_campaign=rl_nov_2026_saison";

const order: Record<"m" | "w" | "u", Array<"m" | "w" | "u">> = { m: ["m", "u", "w"], w: ["w", "u", "m"], u: ["u", "m", "w"] };

function choose(gender: "m" | "w" | "u", size: string | null): Pick[] {
  const pool = order[gender].flatMap((g) => TREND.filter((t) => t.seg === g));
  const own = order[gender][0];
  // own segment first, then the rest; with sure size, size-matching pairs first
  const ranked = [...pool];
  const fits = (t: Pick) => (size ? t.sizes.some((s) => s.size === size) : true);
  const primary = ranked.filter((t) => t.seg === own || own === "u");
  const picked: Pick[] = [];
  for (const t of [...primary.filter(fits), ...ranked.filter(fits), ...ranked]) {
    if (picked.length === 3) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked;
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
      props[`rl_nov_2026_p${n}_caption`] = "Parmi les plus vendues du moment.";
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
