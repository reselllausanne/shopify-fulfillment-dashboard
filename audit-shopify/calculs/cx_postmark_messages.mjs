// Postmark : métadonnées des messages sortants (lecture). Destinataire = hash (pas de PII écrite).
import fs from "node:fs"; import crypto from "node:crypto"; import { pget } from "./cx_postmark_get.mjs";
const out = []; const h = s => crypto.createHash("sha256").update((s||"").toLowerCase()).digest("hex").slice(0, 10);
for (const stream of ["outbound", "broadcast"]) {
  let off = 0;
  for (;;) {
    const r = await pget(`/messages/outbound?count=500&offset=${off}&messagestream=${stream}`);
    if (r.status !== 200) { console.log("ERR", stream, r.status, JSON.stringify(r.body).slice(0, 200)); break; }
    const ms = r.body.Messages || []; if (!ms.length) break;
    for (const m of ms) out.push({ id: m.MessageID, stream, at: m.ReceivedAt, subject: m.Subject, tag: m.Tag, status: m.Status, to: h(m.To?.[0]?.Email), from: (m.From||"").replace(/.*</,"").replace(/>.*/,""), track: m.TrackOpens, meta: m.Metadata, attach: m.Attachments?.length || 0 });
    off += 500; if (off >= 10000 || off >= r.body.TotalCount) break;
  }
  console.log(stream, out.filter(x => x.stream === stream).length);
}
fs.mkdirSync("audit-shopify/donnees_brutes/postmark", { recursive: true });
fs.writeFileSync("audit-shopify/donnees_brutes/postmark/messages_meta.json", JSON.stringify(out));
const agg = {}; for (const m of out) { const k = `${m.stream}|${m.tag || "-"}|${(m.subject||"").replace(/#\d+/g,"#N").slice(0,90)}`; agg[k] = (agg[k] || 0) + 1; }
console.log(Object.entries(agg).sort((a,b)=>b[1]-a[1]).slice(0,60).map(([k,v])=>v+"\t"+k).join("\n"));
console.log("range", out.map(x=>x.at).sort()[0], out.map(x=>x.at).sort().slice(-1)[0], "status", JSON.stringify(out.reduce((a,m)=>(a[m.status]=(a[m.status]||0)+1,a),{})));
