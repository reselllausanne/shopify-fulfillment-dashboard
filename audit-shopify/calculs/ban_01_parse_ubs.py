"""Parse des relevés UBS (PDF 'Mouvements de compte', export e-banking) -> tableaux/ban_01_mouvements_{bus,pers}.csv (données locales : donnees_banque_local/)
Comptes : BUS = Solutions Manzinali (CH06…), PERS = compte personnel du dirigeant (CH50…). Aucune écriture hors fichiers locaux.
Contrôle : continuité des soldes (solde ligne i − montant i = solde ligne i+1, ordre du relevé = plus récent d'abord)."""
import pickle, re, pandas as pd, pathlib
R = pathlib.Path(__file__).resolve().parents[1]; LOC = R / "donnees_banque_local"
store = pickle.load(open(LOC / "pdf_text.pkl", "rb"))
ROW = re.compile(r"^(\d\d\.\d\d\.\d{4}) (.+?) (-?[\d']+\.\d{2}) (\d\d\.\d\d\.\d{4}) (-?[\d']+\.\d{2})$")
num = lambda s: float(s.replace("'", ""))
rows = []; chk = []
for fn, t in store.items():
    if "Du 01.01.2026" in t and "Terme de recherche" in t: continue   # export filtré PayPal (sans soldes) : traité à part
    acct = "BUS" if "CH06 0023" in t else "PERS"
    cur = None; fr = []; prev = ""
    for ln in t.split("\n"):
        m = ROW.match(ln.strip())
        if m:
            d_ = m[2]
            pm = re.match(r"^\d\d\.\d\d\.\d{4} (\S.*)$", prev)
            if pm and not ROW.match(prev) and not re.fullmatch(r"\d\d\.\d\d\.\d{4}", prev.strip()) and (";" in d_ or re.match(r"^\d", d_)):
                d_ = pm[1] + " ; " + d_   # nom de la contrepartie sur la ligne précédente, adresse sur la ligne du montant
            cur = dict(file=fn, acct=acct, date=m[1], desc=d_, amount=num(m[3]), valdate=m[4], balance=num(m[5]), detail=""); fr.append(cur); prev = ln; continue
        prev = ln
        if cur is not None and ln and not re.match(r"^(\d\d\.\d\d\.\d{4}|ab|UBS Switzerland|PO Box|www\.ubs|Pour toutes|Affiché dans|Datedetrans|Datedecompt|Soldeinitial|Mouvements|\(1trans|Cedocument|discordances|inexactitudes|corriger)", ln):
            cur["detail"] = (cur["detail"] + " " + ln).strip()[:200]
    bad = sum(1 for a, b in zip(fr, fr[1:]) if abs(a["balance"] - a["amount"] - b["balance"]) > 0.015)
    chk.append((fn, acct, len(fr), bad)); rows += fr
df = pd.DataFrame(rows); df["d"] = pd.to_datetime(df.date, format="%d.%m.%Y")
n0 = len(df); df["_l"] = df.desc.str.len()
df = df.sort_values("_l", ascending=False).drop_duplicates(subset=["acct", "date", "amount", "balance"]).drop(columns="_l").sort_values(["acct", "d", "balance"], kind="stable")   # même mouvement présent dans plusieurs exports : on garde la description la plus complète
print(pd.DataFrame(chk, columns=["fichier", "compte", "lignes", "ruptures_solde"]).to_string(index=False)); print("lignes", n0, "→ dédupliquées", len(df))
out = pathlib.Path(R / "tableaux"); df.drop(columns=["file", "d"]).to_csv(LOC / "ban_01_mouvements.csv", index=False)
# couverture mensuelle (nombre de lignes, somme)
df["mois"] = df.d.dt.strftime("%Y-%m")
cov = df.groupby(["acct", "mois"]).agg(lignes=("amount", "size"), entrees=("amount", lambda s: s[s > 0].sum()), sorties=("amount", lambda s: s[s < 0].sum())).round(0)
print(cov.to_string())
