"""Parse des 'Liste des paiements' UBS e-banking 2025 (ordres de paiement exécutés depuis le compte personnel). Sortie locale + agrégat publiable (sans IBAN)."""
import pdfplumber, glob, re, pandas as pd, pathlib
R = pathlib.Path(__file__).resolve().parents[1]; LOC = R / "donnees_banque_local"; T = R / "tableaux"
rows = []
for f in sorted(glob.glob("/Users/resell-lausanne/Downloads/ListeDesPaiements_*.pdf")):
    with pdfplumber.open(f) as p:
        txt = "\n".join((pg.extract_text() or "") for pg in p.pages)
    per = re.search(r"Date du: (\S+) au: (\S+)", txt)
    for m in re.finditer(r"^(\d\d\.\d\d\.\d{4}) (.+?) (CH\d{2}[0-9A-Z]{15,19}) (CHF|EUR) ([\d'.,]+)\s*\n(Exécuté|[A-Za-zé ]+) ", txt, re.M):
        rows.append(dict(date=m[1], benef=m[2].strip(), devise=m[4], montant=float(m[5].replace("'", "")), statut=m[6].strip(), periode=per[1] + "→" + per[2]))
d = pd.DataFrame(rows); d["d"] = pd.to_datetime(d.date, format="%d.%m.%Y"); d["mois"] = d.d.dt.strftime("%Y-%m")
d = d.drop_duplicates(); d.to_csv(LOC / "ban_03_paiements_2025.csv", index=False)
print(len(d), d.d.min().date(), d.d.max().date(), d.statut.value_counts().to_dict(), d.devise.value_counts().to_dict())
print(d.groupby("mois").montant.agg(["size", "sum"]).round(0).T.to_string())
g = d.groupby("benef").montant.agg(["size", "sum"]).sort_values("sum", ascending=False).round(0); print(g.head(30).to_string())
