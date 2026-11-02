// Klaviyo LECTURE SEULE : expéditeur des campagnes envoyées (domaine seulement, pas de contenu) et réglages d'envoi (smart sending).
import { kget } from "./cx_klaviyo_get.mjs";
const r = await kget("/api/campaigns?filter=equals(messages.channel,'email')&include=campaign-messages&fields[campaign]=name,status,send_options,send_strategy");
const inc = r.body.included || [];
const out = new Map();
for (const m of inc) {
  const c = m.attributes?.definition?.content || {};
  const dom = String(c.from_email || "").split("@")[1] || "?"; const rt = String(c.reply_to_email || "").split("@")[1] || "?";
  const k = `from@${dom} | reply@${rt}`; out.set(k, (out.get(k) || 0) + 1);
}
console.log("status", r.status, "campagnes:", (r.body.data || []).length, "messages:", inc.length, Object.fromEntries(out));
const opts = (r.body.data || []).map(d => JSON.stringify(d.attributes?.send_options || {})); console.log([...new Set(opts)]);
const st = (r.body.data || []).map(d => d.attributes?.send_strategy?.method + "/" + (d.attributes?.send_strategy?.options_static?.is_local ?? "?")); console.log([...new Set(st)]);
