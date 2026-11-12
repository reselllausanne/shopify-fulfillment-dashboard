// Lecture seule : teste l'accès Search Console (sites.list) avec un compte de service. Aucune clé n'est affichée.
// Usage : GSC_KEY=~/secrets/gsc-cloudsearch.json node gsc_probe.mjs
import fs from "node:fs"; import crypto from "node:crypto";
const keyPath = (process.env.GSC_KEY || "").replace(/^~/, process.env.HOME);
const k = JSON.parse(fs.readFileSync(keyPath, "utf8"));
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: "RS256", typ: "JWT" });
const claim = b64({ iss: k.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(k.private_key, "base64url");
const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }) });
const tj = await tr.json(); if (!tj.access_token) { console.log("TOKEN ERREUR", tr.status, tj.error, tj.error_description); process.exit(1); }
const r = await fetch("https://www.googleapis.com/webmasters/v3/sites", { headers: { authorization: `Bearer ${tj.access_token}` } });
const j = await r.json(); console.log("HTTP", r.status, JSON.stringify(j).slice(0, 600));
