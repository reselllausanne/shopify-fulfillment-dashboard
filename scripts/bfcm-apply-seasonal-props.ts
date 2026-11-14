/**
 * Set rl_nov_2026_p1..p3_* on mailable profiles (properties only, no consent change).
 * p1 UGG, p2 Essentials hoodie, p3 ASICS. Shoes matched on customer's modal adult order size.
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
const SIZES: Record<string, { size: string; n: number; kidsOnly: boolean }> = JSON.parse(readFileSync("/tmp/bfcm-sizes.json", "utf8"));
const CAT: Record<string, any[]> = JSON.parse(readFileSync("/tmp/bfcm-seasonal.json", "utf8"));
const BASE = "https://www.resell-lausanne.ch/products/";
const UTM = "utm_source=klaviyo&utm_medium=email&utm_campaign=rl_nov_2026_saison";

const UGG = ["Tasman Slipper Chestnut", "Neumel Boot Black", "Tasman Slipper Dark Grey", "Neumel Boot Chestnut", "Tasman Slipper Dusted Cocoa"];
const ASICS = ["Gel-Kayano 14 Black Pure Silver", "Gel-Kayano 14 Birch Dark Pewter", "Gel-Kayano 14 Cream Pure Silver Champagne", "Gel-Kayano 14 Metropolis Jasper Green"];

const find = (arr: any[], names: string[]) => names.map((n) => arr.find((p) => p.title.toLowerCase().includes(n.toLowerCase()))).filter(Boolean) as any[];
const ugg = find(CAT.ugg, UGG);
const asics = find(CAT.asics, ASICS);
const hoodie =
  CAT.essentials.find((p) => /fleece hoodie black$/i.test(p.title) && p.image && !/kids/i.test(p.image) && p.inStock.length >= 5) ??
  CAT.essentials.find((p) => p.image && !/kids/i.test(p.image) && p.inStock.length >= 5);
if (!ugg.length || !asics.length || !hoodie) throw new Error("catalog candidates missing");

function card(n: 1 | 2 | 3, p: any, size?: string, label?: string) {
  const v = size ? p.inStock.find((x: any) => x.size === size) : undefined;
  const url = `${BASE}${p.handle}${v ? `?variant=${v.id}&` : "?"}${UTM}`;
  return {
    [`rl_nov_2026_p${n}_ready`]: true,
    [`rl_nov_2026_p${n}_title`]: p.title,
    [`rl_nov_2026_p${n}_caption`]: v ? `Ta pointure ${size} est disponible.` : label!,
    [`rl_nov_2026_p${n}_url`]: url,
    [`rl_nov_2026_p${n}_image`]: p.image,
  };
}

function pick(arr: any[], size: string | undefined) {
  if (!size) return undefined;
  return arr.find((p) => p.inStock.some((v: any) => v.size === size));
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
  const stats = { audience: 0, sized: 0, uggSized: 0, asicsSized: 0, defaults: 0 };
  let done = 0;
  for (const [email, id] of all) {
    if (ex.has(email) || !email) continue;
    stats.audience++;
    const s = SIZES[email];
    const size = s && !s.kidsOnly ? s.size : undefined;
    if (size) stats.sized++; else stats.defaults++;
    const u = pick(ugg, size);
    const a = pick(asics, size);
    if (u) stats.uggSized++;
    if (a) stats.asicsSized++;
    const props = {
      ...card(1, u ?? ugg[0], u ? size : undefined, "Le confort pour l’hiver."),
      ...card(2, hoodie, undefined, "Le hoodie facile pour novembre."),
      ...card(3, a ?? asics[0], a ? size : undefined, "Le classique pour tous les jours."),
    };
    if (APPLY) {
      await k(`https://a.klaviyo.com/api/profiles/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({ data: { type: "profile", id, attributes: { properties: props } } }),
      });
      if (++done % 100 === 0) console.log("patched", done);
    }
  }
  console.log(JSON.stringify({ apply: APPLY, ...stats, hoodie: hoodie.title, ugg: ugg[0].title, asics: asics[0].title }));
})();
