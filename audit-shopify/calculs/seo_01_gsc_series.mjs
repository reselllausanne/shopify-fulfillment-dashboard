// Lecture seule : séries journalières Search Console par segment (langue/type de page, appareil, pays, marque vs hors marque). Clé : GSC_KEY.
import fs from "node:fs"; import crypto from "node:crypto";
const SITE = "sc-domain:resell-lausanne.ch";
const k = JSON.parse(fs.readFileSync((process.env.GSC_KEY || "").replace(/^~/, process.env.HOME), "utf8"));
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const now = Math.floor(Date.now() / 1000);
const h = b64({ alg: "RS256", typ: "JWT" }), c = b64({ iss: k.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
const sig = crypto.createSign("RSA-SHA256").update(`${h}.${c}`).sign(k.private_key, "base64url");
const tok = (await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }) })).json()).access_token;
async function q(body) { const rows = []; for (let s = 0; ; s += 25000) { const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ ...body, rowLimit: 25000, startRow: s }) }); const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error)); const rs = j.rows || []; rows.push(...rs); if (rs.length < 25000) break; } return rows; }
const end = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), start = "2025-07-20";
const segs = {
  page_de: [{ dimension: "page", operator: "contains", expression: "/de/" }], page_en: [{ dimension: "page", operator: "contains", expression: "/en/" }], page_frfr: [{ dimension: "page", operator: "contains", expression: "/fr-fr/" }],
  page_products: [{ dimension: "page", operator: "contains", expression: "/products/" }], page_collections: [{ dimension: "page", operator: "contains", expression: "/collections/" }], page_blogs: [{ dimension: "page", operator: "contains", expression: "/blogs/" }],
  q_marque: [{ dimension: "query", operator: "contains", expression: "resell" }], q_horsmarque: [{ dimension: "query", operator: "notContains", expression: "resell" }],
  dev_mobile: [{ dimension: "device", operator: "equals", expression: "MOBILE" }], dev_desktop: [{ dimension: "device", operator: "equals", expression: "DESKTOP" }],
  c_che: [{ dimension: "country", operator: "equals", expression: "che" }], c_deu: [{ dimension: "country", operator: "equals", expression: "deu" }], c_fra: [{ dimension: "country", operator: "equals", expression: "fra" }],
};
const out = ["segment,date,clicks,impressions,position"];
for (const [name, filters] of Object.entries(segs)) {
  const rows = await q({ startDate: start, endDate: end, dimensions: ["date"], dataState: "final", dimensionFilterGroups: [{ groupType: "and", filters }] });
  for (const r of rows) out.push([name, r.keys[0], r.clicks, r.impressions, r.position.toFixed(2)].join(","));
  console.log(name, rows.length);
}
fs.writeFileSync("audit-shopify/tableaux/seo_01_gsc_segments_jour.csv", out.join("\n"));
