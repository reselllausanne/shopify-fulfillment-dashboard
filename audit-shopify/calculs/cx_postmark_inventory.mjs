// Postmark lecture seule : serveurs, streams, templates, stats, rebonds. Aucun contenu client écrit.
import fs from "node:fs"; import { pget } from "./cx_postmark_get.mjs";
const D = "audit-shopify/donnees_brutes/postmark/"; fs.mkdirSync(D, { recursive: true });
const w = (n, o) => fs.writeFileSync(D + n + ".json", JSON.stringify(o, null, 1));
const srv = (await pget("/server")).body; delete srv.ApiTokens; w("server", srv);
console.log("SERVER", srv.Name, srv.DeliveryType, "TrackOpens", srv.TrackOpens);
const st = await pget("/message-streams"); w("streams", st.body); console.log("STREAMS", JSON.stringify((st.body.MessageStreams||[]).map(s=>[s.ID,s.MessageStreamType,s.CreatedAt?.slice(0,10)])));
const tp = await pget("/templates?count=100&offset=0"); w("templates_list", tp.body); console.log("TEMPLATES", tp.body.TotalCount, JSON.stringify((tp.body.Templates||[]).map(t=>[t.TemplateId,t.Name,t.Alias,t.Active,t.TemplateType])));
const od = await pget("/stats/outbound?fromdate=2025-01-01"); w("stats_outbound_all", od.body); console.log("OUT_ALL", JSON.stringify(od.body));
// par mois 2026
const months = []; for (let m = 1; m <= 11; m++) { const f = `2026-${String(m).padStart(2,"0")}-01`; const t = m === 11 ? "2026-11-02" : `2026-${String(m).padStart(2,"0")}-${[31,28,31,30,31,30,31,31,30,31][m-1]}`; const r = await pget(`/stats/outbound?fromdate=${f}&todate=${t}`); months.push({ month: f.slice(0,7), ...r.body }); }
w("stats_outbound_monthly_2026", months); console.log("MONTHLY"); for (const m of months) console.log(m.month, "sent", m.Sent, "bounced", m.Bounced, "spam", m.SpamComplaints, "opens", m.Opens, "unique", m.UniqueOpens, "tracked", m.TotalTrackedLinksSent, "clicks", m.TotalClicks, "bounceRate", m.BounceRate, "spamRate", m.SpamComplaintsRate);
const tags = await pget("/stats/outbound/sends?fromdate=2026-01-01"); console.log("SENDS", JSON.stringify(tags.body).slice(0, 300));
const bs = await pget("/deliverystats"); w("deliverystats", bs.body); console.log("DELIVERYSTATS", JSON.stringify(bs.body));
