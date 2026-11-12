// Lecture seule : exporte Search Console (agrégats) pour sc-domain:resell-lausanne.ch. Clé : GSC_KEY. Aucune clé écrite.
import fs from "node:fs"; import crypto from "node:crypto";
const SITE = "sc-domain:resell-lausanne.ch";
const k = JSON.parse(fs.readFileSync((process.env.GSC_KEY || "").replace(/^~/, process.env.HOME), "utf8"));
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const now = Math.floor(Date.now() / 1000);
const h = b64({ alg: "RS256", typ: "JWT" }), c = b64({ iss: k.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
const sig = crypto.createSign("RSA-SHA256").update(`${h}.${c}`).sign(k.private_key, "base64url");
const tok = (await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }) })).json()).access_token;
async function q(body) { const rows = []; for (let start = 0; ; start += 25000) { const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ ...body, rowLimit: 25000, startRow: start }) }); const j = await r.json(); if (j.error) throw new Error(JSON.stringify(j.error)); const rs = j.rows || []; rows.push(...rs); if (rs.length < 25000 || rows.length >= (body.maxRows || 1e9)) break; } return rows; }
const end = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), start = new Date(Date.now() - 480 * 864e5).toISOString().slice(0, 10);
const out = "audit-shopify/tableaux/";
const csv = (name, header, rows) => fs.writeFileSync(out + name, [header.join(","), ...rows.map(r => r.map(v => typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v).join(","))].join("\n"));
const d = await q({ startDate: start, endDate: end, dimensions: ["date"], dataState: "final" });
csv("gsc_01_jour.csv", ["date", "clicks", "impressions", "ctr", "position"], d.map(r => [r.keys[0], r.clicks, r.impressions, +r.ctr.toFixed(4), +r.position.toFixed(2)]));
const p = await q({ startDate: start, endDate: end, dimensions: ["page"], dataState: "final", maxRows: 50000 });
csv("../donnees_brutes/gsc/gsc_01_pages.csv", ["page", "clicks", "impressions", "ctr", "position"], p.map(r => [r.keys[0], r.clicks, r.impressions, +r.ctr.toFixed(4), +r.position.toFixed(2)]));
const qq = await q({ startDate: start, endDate: end, dimensions: ["query"], dataState: "final", maxRows: 50000 });
csv("../donnees_brutes/gsc/gsc_01_requetes.csv", ["query", "clicks", "impressions", "ctr", "position"], qq.map(r => [r.keys[0], r.clicks, r.impressions, +r.ctr.toFixed(4), +r.position.toFixed(2)]));
console.log({ debut: d[0]?.keys[0], fin: d.at(-1)?.keys[0], jours: d.length, pages: p.length, requetes: qq.length, clicks: d.reduce((a, r) => a + r.clicks, 0), impressions: d.reduce((a, r) => a + r.impressions, 0) });
