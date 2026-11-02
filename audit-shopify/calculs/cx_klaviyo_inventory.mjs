// Inventaire Klaviyo en lecture seule (GET). Sorties: donnees_brutes/klaviyo/*.json (sans PII profil)
import fs from "node:fs"; import { kget, kall } from "./cx_klaviyo_get.mjs";
const D = "audit-shopify/donnees_brutes/klaviyo/"; fs.mkdirSync(D, { recursive: true });
const w = (n, o) => fs.writeFileSync(D + n + ".json", JSON.stringify(o, null, 1));
// listes avec profile_count
const lists = (await kall("/api/lists/")).data || [];
const lres = [];
for (const l of lists) { const r = await kget(`/api/lists/${l.id}/?additional-fields%5Blist%5D=profile_count`); lres.push({ id: l.id, name: l.attributes.name, created: l.attributes.created, profile_count: r.body?.data?.attributes?.profile_count, status: r.status }); }
w("lists_counts", lres); console.log("LISTS", JSON.stringify(lres));
// campagnes email + sms
for (const ch of ["email", "sms"]) {
  const r = await kall(`/api/campaigns/?filter=equals(messages.channel,'${ch}')&include=campaign-messages`);
  w("campaigns_" + ch, r); console.log("CAMP", ch, r.data?.length ?? JSON.stringify(r).slice(0, 300));
}
// flows details
const flows = (await kall("/api/flows/")).data;
const fd = [];
for (const f of flows) {
  const r = await kget(`/api/flows/${f.id}/?include=flow-actions`);
  fd.push({ flow: f.attributes, id: f.id, actions: (r.body.included || []).map(a => ({ id: a.id, type: a.attributes.action_type, status: a.attributes.status, created: a.attributes.created, updated: a.attributes.updated, settings: a.attributes.settings })) });
}
w("flows_detail", fd); console.log("FLOWS", JSON.stringify(fd.map(x => [x.flow.name, x.flow.status, x.actions.length, x.actions.map(a=>a.type+":"+a.status).join(",")])));
// forms
const forms = await kall("/api/forms/"); w("forms", forms); console.log("FORMS", forms.data?.length ?? JSON.stringify(forms).slice(0, 300));
// templates
const tp = await kall("/api/templates/"); w("templates", tp.data ? tp.data.map(t => ({ id: t.id, name: t.attributes.name, created: t.attributes.created, updated: t.attributes.updated })) : tp); console.log("TPL", tp.data?.length ?? JSON.stringify(tp).slice(0,300));
// segments
const sg = await kall("/api/segments/"); console.log("SEG", JSON.stringify(sg).slice(0, 300));
// tags
const tg = await kall("/api/tags/"); console.log("TAGS", JSON.stringify(tg.data?.map(t=>t.attributes.name)));
// back in stock subscriptions? catalog items
const cat = await kget("/api/catalog-items/?page%5Bsize%5D=1"); console.log("CATALOG", cat.status, JSON.stringify(cat.body).slice(0, 200));
const cf = await kget("/api/coupons/"); console.log("COUPONS", cf.status, JSON.stringify(cf.body).slice(0,200));
