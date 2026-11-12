// Lecture seule : compare deux fenêtres Search Console par page et par requête. Usage : GSC_KEY=... node seo_02_fenetres.mjs A_start A_end B_start B_end tag
import fs from "node:fs"; import crypto from "node:crypto";
const SITE = "sc-domain:resell-lausanne.ch"; const [a0, a1, b0, b1, tag] = process.argv.slice(2);
const k = JSON.parse(fs.readFileSync((process.env.GSC_KEY || "").replace(/^~/, process.env.HOME), "utf8"));
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const now = Math.floor(Date.now() / 1000);
const h = b64({ alg: "RS256", typ: "JWT" }), c = b64({ iss: k.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
const sig = crypto.createSign("RSA-SHA256").update(`${h}.${c}`).sign(k.private_key, "base64url");
const tok = (await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }) })).json()).access_token;
async function q(body) { const rows = []; for (let s = 0; s < 600000; s += 25000) { const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ ...body, rowLimit: 25000, startRow: s }) }); const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error)); const rs = j.rows || []; rows.push(...rs); if (rs.length < 25000) break; } return rows; }
for (const dim of ["page", "query"]) {
  const A = await q({ startDate: a0, endDate: a1, dimensions: [dim], dataState: "final" }), B = await q({ startDate: b0, endDate: b1, dimensions: [dim], dataState: "final" });
  const m = new Map(); for (const r of A) m.set(r.keys[0], { a_imp: r.impressions, a_clk: r.clicks, a_pos: r.position, b_imp: 0, b_clk: 0, b_pos: null });
  for (const r of B) { const e = m.get(r.keys[0]) || { a_imp: 0, a_clk: 0, a_pos: null }; m.set(r.keys[0], { ...e, b_imp: r.impressions, b_clk: r.clicks, b_pos: r.position }); }
  const rows = [...m.entries()].map(([key, v]) => [key, v.a_imp, v.b_imp, v.a_clk, v.b_clk, v.a_pos?.toFixed(2) ?? "", v.b_pos?.toFixed(2) ?? ""]);
  fs.writeFileSync(`audit-shopify/donnees_brutes/gsc/seo_02_${tag}_${dim}.csv`, ["key,a_imp,b_imp,a_clk,b_clk,a_pos,b_pos", ...rows.map(r => `"${String(r[0]).replace(/"/g, '""')}",${r.slice(1).join(",")}`)].join("\n"));
  console.log(dim, "A", A.length, "B", B.length, "union", rows.length);
}
