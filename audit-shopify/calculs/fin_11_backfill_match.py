"""Rattrape les achats StockX non liés aux lignes Shopify sans coût (achat après vente). Lecture seule ; produit une proposition d'appariement.
Entrées : stockx_buying_history.json (API StockX), 08_stx_claimed.csv, lines_with_match.csv, orders_flat.csv. Sortie : tableaux/fin_11_backfill_proposition.csv"""
import pandas as pd, numpy as np, json, re, pathlib
R = pathlib.Path(__file__).resolve().parents[1]; D, T = R / "donnees_brutes", R / "tableaux"
s = pd.DataFrame(json.load(open(D / "stockx_buying_history.json"))); s["pd"] = pd.to_datetime(s.purchaseDate, utc=True)
m = pd.read_csv(D / "04_ordermatch_lines.csv"); cl = pd.read_csv(D / "08_stx_claimed.csv")
claimed = set(m.stockxOrderNumber.dropna().astype(str)) | set(cl.n.dropna().astype(str)) | set(cl.oid.dropna().astype(str))
s["claimed"] = s.orderNumber.astype(str).isin(claimed) | s.orderId.astype(str).isin(claimed)
free = s[(~s.claimed) & (s.status != "CANCELLED") & (s.pd >= "2025-12-01")].copy()
print("achats libres (non liés Shopify/Galaxus), depuis 2025-12 :", len(free), free.amount.sum().round(0))
o = pd.read_csv(D / "orders_flat.csv"); o["c"] = pd.to_datetime(o.created_utc, utc=True)
x = pd.read_csv(D / "lines_with_match.csv").merge(o[["id", "fin", "ful", "c", "test"]], left_on="order_id", right_on="id")
u = x[(~x.has_match) & (x.c >= "2026-01-01") & (~x.test) & (x.fin != "REFUNDED")].copy()
norm = lambda t: re.sub(r"[^a-z0-9]+", " ", str(t).lower()).strip()
sz = lambda v: re.sub(r"^(eu|us)\s*", "", str(v).lower()).replace(",", ".").strip()
u["k"] = u.title.map(norm); free["k"] = free.title.map(norm)
u["sz"] = u.variant.map(sz); free["sz"] = free["size"].map(sz)
rows = []; used = set()
def eu(v):
    v = str(v or "").strip()
    m_ = re.match(r"^EU\s*(\d+(?:\.\d+)?)(?:\s+(\d)/(\d))?", v, re.I)
    if not m_: return None
    val = float(m_.group(1)) + (int(m_.group(2)) / int(m_.group(3)) if m_.group(2) else 0)
    return round(val * 2) / 2  # 40 2/3 -> 40.5 ; 41 1/3 -> 41.5 (arrondi au demi)
free["style"] = free.styleId.fillna("").map(lambda v: str(v).split("/")[0].strip().lower()); free["eu"] = free["size"].map(eu)
def fl(v):
    try: return float(str(v).replace(",", "."))
    except: return None
for r in u.sort_values("c").itertuples():
    sku = str(r.sku).lower(); vsz = fl(r.variant)
    cand = free[(free.style != "") & free.style.map(lambda st: sku.startswith(st + "-")) & (free.pd >= r.c - pd.Timedelta(days=1)) & (~free.orderNumber.isin(used))]
    how = "style+taille"
    exact = cand[cand.eu == vsz] if vsz is not None else cand.iloc[0:0]
    if len(exact): cand = exact
    elif len(cand) and cand.eu.isna().all() and len(cand) == 1: how = "style seul (taille StockX non EU)"
    else:
        t = free[(free.k == r.k) & (free.pd >= r.c - pd.Timedelta(days=1)) & (~free.orderNumber.isin(used)) & ((free.eu == vsz) | free.eu.isna())]
        cand = t; how = "titre (+taille)"
    if len(cand):
        b = cand.sort_values("pd").iloc[0]; used.add(b.orderNumber)
        rows.append(dict(order=r.order, line_id=r.lid, titre=r.title[:50], taille=r.variant, prix_ttc=r.disc_total, vente_utc=r.c, achat_utc=b.pd, delai_jours=round((b.pd - r.c).total_seconds() / 86400, 1),
                         stockx_order=b.orderNumber, bid_chf=b.amount, cout_estime_rendu=round(b.amount + 28.4, 2), statut_stockx=b.status, methode=how))
p = pd.DataFrame(rows); p.to_csv(T / "fin_11_backfill_proposition.csv", index=False)
print("lignes sans coût (non remboursées) :", len(u), round(u.disc_total.sum()), "| appariées par rattrapage :", len(p), round(p.prix_ttc.sum()))
print(p.delai_jours.describe().round(1).to_dict() if len(p) else "")
rest = u[~u.lid.isin(p.line_id)] if len(p) else u
print("restantes :", len(rest), round(rest.disc_total.sum()), rest.groupby("ful").size().to_dict())
