"""Taxonomie des événements de timeline Shopify 2026 (messages normalisés). Sortie: tableaux/cx_02_events_taxonomy.csv"""
import json, re, collections, csv
c = collections.Counter(); by_type = collections.Counter(); orders = 0; with_comment = 0; n = 0
cm = []
for l in open("audit-shopify/donnees_brutes/cx_orders_timeline_2026.ndjson"):
    o = json.loads(l); n += 1; hc = False
    seen = set()
    for e in o["events"]:
        m = re.sub(r"#\d+|CHF\s?[\d.,']+|EUR\s?[\d.,']+|€\s?[\d.,]+|\b\d{4,}\b|\bNov \d+, 2026\b|[A-Z][a-z]{2} \d{1,2}, 20\d\d", "#", e["m"] or "")
        m = re.sub(r"\[client\]|\[email\]", "[x]", m)[:110]
        key = (e["t"], m)
        c[key] += 1
        if (key not in seen): seen.add(key)
        if e["t"] == "CommentEvent": hc = True; cm.append((o["name"], e["at"], (e["m"] or "")[:200]))
    with_comment += hc
print("orders", n, "with staff comment", with_comment)
rows = c.most_common(70)
for (t, m), k in rows: print(k, t, m)
csv.writer(open("audit-shopify/tableaux/cx_02_events_taxonomy.csv", "w")).writerows([["type", "message_norm", "n"]] + [[t, m, k] for (t, m), k in c.most_common(300)])
json.dump(cm, open("/tmp/cx/comments.json", "w"), ensure_ascii=False)
print("comments", len(cm))
