import { token, SITE } from "./gsc_lib.mjs";
const t = await token();
const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/sitemaps`, { headers: { authorization: `Bearer ${t}` } });
console.log(JSON.stringify(await r.json(), null, 1));
