/**
 * Buyers (CH) who never opted in on Shopify but were informed at checkout (owner decision, 26 Nov 2026).
 * Creates list "BFCM 2026 — clients jamais contactés" and subscribes them to it via Klaviyo bulk-subscribe.
 * Excludes: Shopify UNSUBSCRIBED, exclusion/pause/opposition CSVs, existing Email List members, non-CH.
 * Flags: --apply (default dry run), --list=<id> (reuse list).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const APPLY = process.argv.includes("--apply");
const DIR = "/Users/resell-lausanne/Downloads/Listes_exclusions_Resell_Lausanne_2026-11-14";
const H: any = { Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`, accept: "application/vnd.api+json", "content-type": "application/vnd.api+json", revision: "2025-10-15" };
async function k(p: string, m = "GET", b?: any): Promise<any> {
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(`https://a.klaviyo.com/api/${p}`, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
      const t = await r.text();
      if (!r.ok) throw Object.assign(new Error(`${p} ${r.status} ${t.slice(0, 300)}`), { status: r.status });
      return t ? JSON.parse(t) : {};
    } catch (e: any) {
      if (e.status) throw e;
      await new Promise((x) => setTimeout(x, 4000));
    }
  }
  throw new Error("network");
}
(async () => {
  const ex = new Set<string>();
  for (const f of readdirSync(DIR).filter((f) => /^(01_Pause_SAV|02_Exclusion_Black_Friday|03_Opposition_emails)\.csv$/.test(f)))
    for (const m of readFileSync(join(DIR, f), "utf8").matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) ex.add(m[0].toLowerCase());
  const buyers: any[] = JSON.parse(readFileSync("/tmp/bf-nonsub-buyers.json", "utf8"));
  // existing Email List members + flagged profiles
  const inList = new Set<string>();
  let next: string | null = "lists/QNJ57e/profiles/?fields[profile]=email&page[size]=100";
  while (next) {
    const j: any = await k(next.replace("https://a.klaviyo.com/api/", ""));
    j.data.forEach((x: any) => inList.add(String(x.attributes.email).toLowerCase()));
    next = j.links?.next ?? null;
  }
  const rows = buyers.filter((b) => (b.defaultAddress?.countryCodeV2 ?? "") === "CH");
  const emails = [...new Set(rows.map((b) => String(b.email).toLowerCase()))].filter((e) => !ex.has(e) && !inList.has(e));
  console.log({ buyersNonSub: buyers.length, ch: rows.length, exclusions: ex.size, inEmailList: inList.size, toSubscribe: emails.length });
  if (!APPLY) return;
  let listId = process.argv.find((a) => a.startsWith("--list="))?.split("=")[1];
  if (!listId) {
    const l = await k("lists/", "POST", { data: { type: "list", attributes: { name: "BFCM 2026 — clients jamais contactés" } } });
    listId = l.data.id;
  }
  console.log("list", listId);
  let ok = 0;
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    await k("profile-subscription-bulk-create-jobs/", "POST", {
      data: {
        type: "profile-subscription-bulk-create-job",
        attributes: {
          custom_source: "Checkout notice - existing customers (owner decision 2026-11-26)",
          profiles: { data: chunk.map((email) => ({ type: "profile", attributes: { email, subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } } } })) },
        },
        relationships: { list: { data: { type: "list", id: listId } } },
      },
    });
    ok += chunk.length;
    console.log("queued", ok);
  }
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
