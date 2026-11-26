/**
 * Mail "Black Friday ouvert" to CH buyers who never opted in (owner decision 26 Nov 2026), via Postmark BROADCAST stream.
 * Template source: Klaviyo template of campaign 09 (generic pairs, no size). Unsubscribe = Postmark {{{ pm:unsubscribe }}}.
 * Flags: --test (only reselllausanne@gmail.com), --send (real), --at=<ISO> (wait until then), --limit=N
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PM = "https://api.postmarkapp.com";
const PMH = { "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN ?? "", Accept: "application/json", "Content-Type": "application/json" };
const KH: any = { Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`, accept: "application/vnd.api+json", revision: "2025-10-15" };
const STREAM = "bfcm-broadcast";
const FROM = "Resell Lausanne <contact@resell-lausanne.ch>";
const SUBJECT = "Black Friday : c’est ouvert";
const DIR = "/Users/resell-lausanne/Downloads/Listes_exclusions_Resell_Lausanne_2026-11-14";
const TEST = process.argv.includes("--test");
const SEND = process.argv.includes("--send");
const AT = process.argv.find((a) => a.startsWith("--at="))?.split("=")[1];
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

async function pm(path: string, method = "GET", body?: unknown): Promise<any> {
  const r = await fetch(`${PM}${path}`, { method, headers: PMH, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`postmark ${path} ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}
async function kl(path: string): Promise<any> {
  for (let i = 0; i < 6; i++) {
    try {
      return await (await fetch(`https://a.klaviyo.com/api/${path}`, { headers: KH })).json();
    } catch {
      await new Promise((x) => setTimeout(x, 3000));
    }
  }
  throw new Error("network");
}

async function loadTemplate(): Promise<{ html: string; text: string }> {
  const j = await kl("templates/?sort=-created&page[size]=10");
  const t = j.data.find((x: any) => /09 Clients jamais contactés/.test(x.attributes.name) && !/TEST/.test(x.attributes.name));
  if (!t) throw new Error("template 09 not found");
  const full = await kl(`templates/${t.id}`);
  let { html, text } = full.data.attributes;
  // keep ONLY the generic branch of the size-range liquid
  const keep = (s: string) => {
    const a = s.indexOf("{% else %}");
    const e = s.indexOf("{% endif %}", a);
    if (a < 0 || e < 0) throw new Error("generic branch not found");
    const ifStart = s.lastIndexOf("{% if person|lookup:'rl_bf_2026_size_range'", a);
    return s.slice(0, ifStart) + s.slice(a + "{% else %}".length, e) + s.slice(e + "{% endif %}".length);
  };
  html = keep(html);
  text = keep(text);
  html = html.replace(/\{% unsubscribe_link %\}/g, "{{{ pm:unsubscribe }}}");
  text = text.replace(/\{% unsubscribe_link %\}/g, "{{{ pm:unsubscribe }}}");
  html = html.replace(/\{\{ person\.email\|urlencode \}\}/g, "");
  text = text.replace(/\{\{ person\.email\|urlencode \}\}/g, "");
  if (/\{%|\{\{ ?person/.test(html + text)) throw new Error("liquid left: " + (html + text).match(/\{%[^%]*%\}|\{\{ ?person[^}]*\}\}/)?.[0]);
  if (!html.includes("pm:unsubscribe")) throw new Error("unsubscribe missing");
  return { html, text };
}

async function recipients(): Promise<string[]> {
  if (TEST) return ["reselllausanne@gmail.com"];
  const ex = new Set<string>();
  for (const f of readdirSync(DIR).filter((f) => /^(01_Pause_SAV|02_Exclusion_Black_Friday|03_Opposition_emails)\.csv$/.test(f)))
    for (const m of readFileSync(join(DIR, f), "utf8").matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) ex.add(m[0].toLowerCase());
  const buyers: any[] = JSON.parse(readFileSync("/tmp/bf-nonsub-buyers.json", "utf8"));
  let out = [...new Set(buyers.filter((b) => b.defaultAddress?.countryCodeV2 === "CH").map((b) => String(b.email).toLowerCase()))].filter((e) => !ex.has(e));
  if (LIMIT) out = out.slice(0, LIMIT);
  return out;
}

(async () => {
  const { html, text } = await loadTemplate();
  const streams = await pm("/message-streams");
  if (!streams.MessageStreams.some((s: any) => s.ID === STREAM)) {
    await pm("/message-streams", "POST", { ID: STREAM, Name: "BFCM broadcast", MessageStreamType: "Broadcasts" });
    console.log("created stream", STREAM);
  }
  const to = await recipients();
  console.log({ recipients: to.length, test: TEST, send: SEND, at: AT });
  if (!SEND && !TEST) return;
  if (AT) {
    const ms = Date.parse(AT) - Date.now();
    if (ms < 0) throw new Error("--at already past");
    console.log("waiting", Math.round(ms / 1000), "s");
    await new Promise((r) => setTimeout(r, ms));
  }
  let sent = 0, failed = 0;
  for (let i = 0; i < to.length; i += 500) {
    const batch = to.slice(i, i + 500).map((email) => ({
      From: FROM, To: email, Subject: SUBJECT, HtmlBody: html, TextBody: text, MessageStream: STREAM, Tag: "bfcm-clients-2026",
      TrackOpens: true, TrackLinks: "HtmlOnly", Metadata: { campaign: "bfcm_2026_clients" },
    }));
    const res = await pm("/email/batch", "POST", batch);
    for (const r of res) (r.ErrorCode === 0 ? sent++ : failed++);
    console.log("batch", i, "sent", sent, "failed", failed);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("done", { sent, failed });
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
