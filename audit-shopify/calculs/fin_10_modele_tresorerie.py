"""Modèle de trésorerie modifiable (classeur Excel avec formules) + moteur Python identique pour comparatifs/stress.
Hypothèses calibrées sur 2026-01→10 (fin_05). Aucune donnée bancaire disponible : trésorerie d'ouverture = paramètre à renseigner.
Sorties : tableaux/modele_tresorerie.xlsx, tableaux/fin_10_scenarios.csv, fin_10_stress.csv, fin_10_seuils.csv"""
import pandas as pd, numpy as np, pathlib, datetime as dt
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter as L
R = pathlib.Path(__file__).resolve().parents[1]; T = R / "tableaux"

# ---------- calibrage depuis les données ----------
p = pd.read_csv(T / "fin_05_orders_pnl.csv"); n = len(p)
gross = p.ventes_brutes_ttc.sum(); refunds = p.refunded.sum(); retained = p.revenu_conserve_ttc.sum()
cal = dict(aov=gross / n, refund=refunds / gross, vat=p.tva.sum() / retained, cogs=p.cogs.sum() / p.revenu_net_ht.sum(),
           fees=p.frais_paiement.sum() / retained, exp=p.exp_prep.sum() / n, disp=5305 / retained, ads=100856 / n)
print({k: round(v, 4) for k, v in cal.items()})
MONTHS = [dt.date(2026, 11, 1) + dt.timedelta(days=31 * i) for i in range(12)]
MONTHS = [dt.date(2026 + (10 + i) // 12, (10 + i) % 12 + 1, 1) for i in range(12)]  # nov-26 .. oct-27
SEAS = [1.6, 2.5, 1.2, 0.75, 0.9, 0.9, 0.85, 0.7, 0.85, 1.3, 1.2, 1.25]  # indice vs niveau moyen fév-oct 2026 (283 cmd/mois)
BASE_ORDERS = 283.0
WEEK_W = [1.0, 1.1, 1.3, 2.8, 1.8, 2.0, 2.6, 1.6, 1.0, 1.2, 1.0, 0.9, 0.9]  # poids relatifs des 13 sem. depuis le 2026-11-02
SCEN = ["Prudent", "Central", "Favorable", "Redressement"]
PARAMS = [  # key, label, unit, values(P,C,F,R), source/confiance
    ("vol", "Facteur de volume vs niveau 2026", "x", [0.85, 1.00, 1.15, 0.85], "Hypothèse. Redressement = pub réduite → moins de volume"),
    ("aov", "Panier brut TTC moyen", "CHF", [cal["aov"], cal["aov"], cal["aov"], 245.0], "Fait 2026 (fin_05). Redressement : +3 % via prix/mix (hypothèse)"),
    ("refund", "Taux de remboursement (part du brut)", "%", [0.095, cal["refund"], 0.070, 0.065], "Fait 2026 = 8,4 %. Redressement : délais/promesse (hypothèse)"),
    ("vat", "TVA TDFN (part du TTC conservé)", "%", [0.021] * 4, "DÉCLARATION UTILISATEUR 2026-11-02 : forfait 2,1 % — à prouver par décomptes AFC/banque"),
    ("cogs", "Coût d'achat (part du net HT conservé)", "%", [0.760, cal["cogs"], 0.700, cal["cogs"]], "Fait 2026 (dont ≈6 % du net estimé non apparié). TVA import non récupérée. Favorable ≤ Central (corrigé : relecture)"),
    ("fees", "Frais de paiement (part du TTC conservé)", "%", [0.030, cal["fees"], 0.027, cal["fees"]], "Fait partiel (SP observés, autres estimés)"),
    ("exp", "Expédition + préparation par commande", "CHF", [15.0, cal["exp"], 13.0, 13.0], "Forfaits 6,5+8,0 du dépôt ; coûts réels Poste/main d'œuvre non fournis"),
    ("disp", "Litiges / chargebacks (part du TTC conservé)", "%", [0.012, cal["disp"], 0.005, 0.004], "Fait 2026 (litiges perdus)"),
    ("ads", "Publicité par commande", "CHF", [42.0, 35.0, 30.0, 18.0], "Fait 2026 = 35 ; oct-26 ≈ 41. Redressement ≈ niveau oct-25 (15) + marge"),
    ("soft", "Logiciels / abonnements par mois", "CHF", [325.0] * 4, "Fait (RecurringExpense, partiel)"),
    ("fixother", "Autres charges fixes par mois (loyer, compta, assurance, comptes…)", "CHF", [0.0] * 4, "MANQUANT — à renseigner (aucune donnée bancaire)"),
    ("owner", "Rémunération du dirigeant par mois", "CHF", [6000.0] * 4, "HYPOTHÈSE (non fournie)"),
]
KEYS = [k for k, *_ in PARAMS]
m_ = pd.read_csv(T / "fin_05_pnl_mensuel.csv"); m_ = m_[m_.mois.between("2026-07", "2026-10")]
VAT_JUL_OCT = float(m_.tva.sum())  # TDFN 2,1 % déclaré par le dirigeant ; jul-oct 2026 faisant partie du semestre S2 (jul-déc), décompte dû ~28 fév 2027
VAT_Q3_2026 = 0.0  # plus de paiement TVA trimestriel dans les 13 semaines (TDFN : décomptes semestriels)
VAT_OCT_2026 = VAT_JUL_OCT
# Ouverture au 2026-11-04 (D, fournie par le dirigeant) : perso 8 734,47 + 3 051 de côté + pro 340 + 14 000 de côté = 26 125,47 ; Amex due 17 200 (H : montant dû) ; solde TVA S1-2026 restant ≈ 5 956 (décompte 7 021,30 − 1 065 payés ; intérêts moratoires non inclus)
OPENING_CASH = 26125.47 - 17200.0 - 5956.0

def engine(P, seas=SEAS, opening=OPENING_CASH, galaxus_support=0.0):
    rows = []
    for i, s in enumerate(seas):
        o = BASE_ORDERS * s * P["vol"]; g = o * P["aov"]; rf = g * P["refund"]; rt = g - rf; v = rt * P["vat"]; net = rt - v
        cg = net * P["cogs"]; fe = rt * P["fees"]; ex = o * P["exp"]; di = rt * P["disp"]; cb = net - cg - fe - ex - di; ad = o * P["ads"]
        res = cb - ad - P["soft"] - P["fixother"]
        rows.append(dict(mois=MONTHS[i].strftime("%Y-%m"), commandes=o, brut=g, rembours=rf, conserve=rt, tva=v, net_ht=net, cogs=cg, frais=fe, exp=ex, litiges=di,
                         contrib_avant_pub=cb, pub=ad, fixes=P["soft"] + P["fixother"], resultat_avant_remun=res, remun=P["owner"], resultat_apres_remun=res - P["owner"]))
    d = pd.DataFrame(rows)
    vat_paid = np.zeros(12)
    vat_paid[3] = VAT_JUL_OCT + d.tva[0] + d.tva[1]  # fév-27 : S2-2026
    vat_paid[9] = d.tva[2:8].sum()  # août-27 : S1-2027 (jan-juin)
    d["tva_payee"] = vat_paid
    d["flux"] = d.resultat_apres_remun + d.tva - d.tva_payee + galaxus_support
    d["tresorerie_fin"] = opening + d.flux.cumsum()
    return d

def engine13(P, d, opening=OPENING_CASH, rec_share=0.45, cogs_share=0.29, hold_weeks=0):
    tot = d.commandes[:3].sum(); w = np.array(WEEK_W) / sum(WEEK_W); o = tot * w
    g = o * P["aov"]; rt = g * (1 - P["refund"]); v = rt * P["vat"]; net = rt - v; cg = net * P["cogs"]; fe = rt * P["fees"]; ex = o * P["exp"]; di = rt * P["disp"]; ad = o * P["ads"]
    prev_rt = BASE_ORDERS / 4.33 * P["aov"] * (1 - P["refund"]); prev_cg = prev_rt * (1 - P["vat"]) * P["cogs"]
    rec = np.zeros(13); pay = np.zeros(13)
    for k in range(13):
        a = rt[k - 1] if k else prev_rt; b = cg[k - 1] if k else prev_cg
        rec[k] = rec_share * rt[k] + (1 - rec_share) * a if hold_weeks == 0 else (rt[k - hold_weeks] if k >= hold_weeks else prev_rt)
        pay[k] = cogs_share * cg[k] + (1 - cogs_share) * b
    fixed = (P["soft"] + P["fixother"] + P["owner"]) / 4.33; vatp = np.zeros(13); vatp[4] = VAT_Q3_2026
    flux = rec - fe - pay - ex - di - ad - fixed - vatp
    return pd.DataFrame(dict(sem=[(dt.date(2026, 11, 2) + dt.timedelta(days=7 * k)).isoformat() for k in range(13)], commandes=o, recettes=rec, achats_payes=pay, frais=fe, exp=ex, litiges=di, pub=ad,
                             fixes_remun=fixed, tva_payee=vatp, flux=flux, tresorerie_fin=opening + np.cumsum(flux)))

# ---------- comparatifs ----------
P_of = lambda j: {k: vals[j] for k, _, _, vals, _ in PARAMS}
comp = []
for j, s in enumerate(SCEN):
    P = P_of(j); d = engine(P); w = engine13(P, d)
    comp.append(dict(scenario=s, commandes_12m=d.commandes.sum(), ca_brut_ttc=d.brut.sum(), contrib_avant_pub=d.contrib_avant_pub.sum(), pub=d.pub.sum(), resultat_avant_remun=d.resultat_avant_remun.sum(),
                     resultat_apres_remun=d.resultat_apres_remun.sum(), tva_payee_12m=d.tva_payee.sum(), flux_net_12m=d.flux.sum(), tresorerie_min_mois=d.tresorerie_fin.min(), tresorerie_min_13sem=w.tresorerie_fin.min()))
comp = pd.DataFrame(comp).round(0); comp.to_csv(T / "fin_10_scenarios.csv", index=False); print(comp.to_string())
# ---------- stress (autour du Central) ----------
C = P_of(1); base = engine(C); bw = engine13(C, base)
def stress(name, P=None, seas=None, **kw):
    P = P or dict(C); d = engine(P, seas=seas or SEAS); w = engine13(P, d, **kw)
    return dict(test=name, resultat_apres_remun_12m=d.resultat_apres_remun.sum(), flux_net_12m=d.flux.sum(), tresorerie_min_mois=d.tresorerie_fin.min(), tresorerie_min_13sem=w.tresorerie_fin.min(),
                delta_flux_vs_central=d.flux.sum() - base.flux.sum())
S = [stress("Central (référence)")]
S.append(stress("S1 CPC +25 % (pub/commande ×1,25 à volume égal)", {**C, "ads": C["ads"] * 1.25}))
S.append(stress("S2 Remboursements +4 pts et litiges ×2", {**C, "refund": C["refund"] + 0.04, "disp": C["disp"] * 2}))
S.append(stress("S3 Pic manqué : nov-déc-jan −35 % de volume", None, [SEAS[0] * .65, SEAS[1] * .65, SEAS[2] * .65] + SEAS[3:]))
S.append(stress("S4 Réserve Shopify Payments 14 j (encaissement décalé 2 sem.)", None, None, hold_weeks=2))
S.append(stress("S5 S1+S2+S3 combinés", {**C, "ads": C["ads"] * 1.25, "refund": C["refund"] + .04, "disp": C["disp"] * 2}, [SEAS[0] * .65, SEAS[1] * .65, SEAS[2] * .65] + SEAS[3:]))
pd.DataFrame(S).round(0).to_csv(T / "fin_10_stress.csv", index=False); print(pd.DataFrame(S).round(0).to_string())
# ---------- seuils de rentabilité ----------
def contrib_per_order(P):
    rt = P["aov"] * (1 - P["refund"]); net = rt * (1 - P["vat"]); return net - net * P["cogs"] - rt * P["fees"] - P["exp"] - rt * P["disp"]
cpo = contrib_per_order(C); rows = []
for ads in [0, 10, 18, 25, 35]:
    for own in [0, 3000, 6000]:
        m = cpo - ads; fx = C["soft"] + own
        rows.append(dict(pub_par_cmd=ads, remun_mois=own, contrib_par_cmd=round(m, 1), cmd_par_mois_requises=round(fx / m) if m > 0 else None))
pd.DataFrame(rows).to_csv(T / "fin_10_seuils.csv", index=False); print("contrib/cmd avant pub (central):", round(cpo, 2)); print(pd.DataFrame(rows).to_string())

# ---------- classeur ----------
wb = Workbook(); H = wb.active; H.title = "Hypotheses"
bold = Font(bold=True); inp = PatternFill("solid", fgColor="FFF2CC"); warn = PatternFill("solid", fgColor="F8CBAD"); hdr = PatternFill("solid", fgColor="D9E1F2")
H["A1"] = "MODÈLE DE TRÉSORERIE SHOPIFY / RESELL LAUSANNE — hypothèses modifiables (cellules jaunes)"; H["A1"].font = Font(bold=True, size=13)
H["A2"] = "Scénario actif (1 Prudent, 2 Central, 3 Favorable, 4 Redressement)"; H["B2"] = 2; H["B2"].fill = inp
H["A3"] = "Trésorerie d'ouverture CHF — MANQUANT (aucune donnée bancaire)"; H["B3"] = OPENING_CASH; H["B3"].fill = warn
H["A4"] = "Niveau de base commandes/mois (moy. fév-oct 2026)"; H["B4"] = BASE_ORDERS; H["B4"].fill = inp
H["D2"] = "CHF, TTC sauf mention ; période : 12 mois nov-2026→oct-2027 ; Europe/Zurich ; nature : flux d'exploitation Shopify seul (hors Galaxus)"
for c, hname in enumerate(["Paramètre", "Unité"] + SCEN + ["ACTIF", "Source / confiance"], 1):
    H.cell(6, c, hname).font = bold; H.cell(6, c).fill = hdr
ROW = {}
for r, (k, lab, unit, vals, src) in enumerate(PARAMS, 7):
    ROW[k] = r; H.cell(r, 1, lab); H.cell(r, 2, unit)
    for j, v in enumerate(vals):
        c = H.cell(r, 3 + j, float(v)); c.fill = warn if k in ("fixother",) else inp
        if unit == "%": c.number_format = "0.0%"
    H.cell(r, 7, f"=INDEX(C{r}:F{r},1,$B$2)"); H.cell(r, 8, src)
    if unit == "%": H.cell(r, 7).number_format = "0.0%"
r0 = 7 + len(PARAMS) + 1
H.cell(r0, 1, "(inutilisé) TVA trimestrielle — remplacée par TDFN semestriel").font = bold; H.cell(r0, 7, VAT_Q3_2026).fill = inp
H.cell(r0 + 1, 1, "TVA TDFN 2,1 % jul-oct 2026 (S2-2026), payable ~28 fév 2027 — calculée sur le CA TTC conservé (fin_05)"); H.cell(r0 + 1, 7, VAT_OCT_2026).fill = inp
H.cell(r0 + 2, 1, "Part encaissée la même semaine (reste = sem. suivante) — payout SP ≈ 4 j"); H.cell(r0 + 2, 7, 0.45).fill = inp
H.cell(r0 + 3, 1, "Part des achats StockX payée la même semaine (délai 5 j par défaut du cron)"); H.cell(r0 + 3, 7, 0.29).fill = inp
H.cell(r0 + 4, 1, "Soutien externe mensuel injecté (Galaxus/privé) CHF — 0 par défaut, aucune preuve de flux"); H.cell(r0 + 4, 7, 0.0).fill = inp
R_VAT3, R_VATO, R_REC, R_COG, R_SUP = r0, r0 + 1, r0 + 2, r0 + 3, r0 + 4
H.column_dimensions["A"].width = 70; H.column_dimensions["H"].width = 80
for c in "CDEFG": H.column_dimensions[c].width = 14
g = lambda k: f"Hypotheses!$G${ROW[k]}"
# --- Mensuel
M = wb.create_sheet("Mensuel_12m"); M["A1"] = "Projection 12 mois (scénario actif) — CHF"; M["A1"].font = Font(bold=True, size=13)
M.cell(3, 1, "Mois").font = bold
for i, m in enumerate(MONTHS): M.cell(3, 2 + i, m.strftime("%Y-%m")).font = bold
M.cell(3, 14, "Total").font = bold
labels = ["Indice saisonnier (hyp.)", "Commandes", "Brut TTC", "Remboursements", "TTC conservé", "TVA", "Net HT", "Coût d'achat", "Frais paiement", "Expédition+prépa", "Litiges",
          "Contribution avant pub", "Publicité", "Charges fixes", "Résultat avant rémunération", "Rémunération", "Résultat après rémunération", "TVA TDFN payée (semestres, décalage 60 j)", "Soutien externe",
          "Flux net trésorerie", "Trésorerie fin de mois"]
for r, lab in enumerate(labels, 4): M.cell(r, 1, lab)
for i in range(12):
    c = L(2 + i); f = lambda r: f"{c}{r}"
    M[f(4)] = SEAS[i]; M[f(4)].fill = inp
    M[f(5)] = f"=Hypotheses!$B$4*{f(4)}*{g('vol')}"; M[f(6)] = f"={f(5)}*{g('aov')}"; M[f(7)] = f"={f(6)}*{g('refund')}"; M[f(8)] = f"={f(6)}-{f(7)}"
    M[f(9)] = f"={f(8)}*{g('vat')}"; M[f(10)] = f"={f(8)}-{f(9)}"; M[f(11)] = f"={f(10)}*{g('cogs')}"; M[f(12)] = f"={f(8)}*{g('fees')}"; M[f(13)] = f"={f(5)}*{g('exp')}"; M[f(14)] = f"={f(8)}*{g('disp')}"
    M[f(15)] = f"={f(10)}-{f(11)}-{f(12)}-{f(13)}-{f(14)}"; M[f(16)] = f"={f(5)}*{g('ads')}"; M[f(17)] = f"={g('soft')}+{g('fixother')}"; M[f(18)] = f"={f(15)}-{f(16)}-{f(17)}"
    M[f(19)] = f"={g('owner')}"; M[f(20)] = f"={f(18)}-{f(19)}"
    vp = {3: f"=Hypotheses!$G${R_VATO}+B9+C9", 9: "=SUM(D9:I9)"}
    M[f(21)] = vp.get(i, 0); M[f(22)] = f"=Hypotheses!$G${R_SUP}"
    M[f(23)] = f"={f(20)}+{f(9)}-{f(21)}+{f(22)}"
    M[f(24)] = (f"=Hypotheses!$B$3+{f(23)}" if i == 0 else f"={L(1 + i)}24+{f(23)}")
for r in [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]: M.cell(r, 14, f"=SUM(B{r}:M{r})")
for r in range(4, 25):
    for cc in range(2, 15): M.cell(r, cc).number_format = "#,##0.00" if r == 4 else "#,##0"
for r in (15, 18, 20, 23, 24): M.cell(r, 1).font = bold
M.cell(26, 1, "Lecture : la TVA est exclue du résultat (collectée pour l'AFC) mais payée en trésorerie par trimestre. TVA d'importation sur achats supposée non récupérée (scénario B de fin_06 = +11 k CHF sur 10 mois, à prouver).")
M.column_dimensions["A"].width = 44
# --- 13 semaines
W = wb.create_sheet("Sem_13"); W["A1"] = "Plan de trésorerie 13 semaines (du 2026-11-02 au 2027-01-31) — scénario actif — CHF"; W["A1"].font = Font(bold=True, size=13)
W.cell(3, 1, "Semaine du").font = bold
for k in range(13): W.cell(3, 2 + k, (dt.date(2026, 11, 2) + dt.timedelta(days=7 * k))).number_format = "yyyy-mm-dd"
wl = ["Poids hebdo (hyp.)", "Commandes", "TTC conservé (ventes − remb.)", "Net HT", "Coût d'achat (engagé)", "Encaissements (payouts, décalés)", "Achats StockX payés (décalés 5 j)", "Frais paiement",
      "Expédition+prépa", "Litiges", "Publicité", "Fixes + rémunération", "TVA payée", "Soutien externe", "Flux net", "Trésorerie fin de semaine"]
for r, lab in enumerate(wl, 4): W.cell(r, 1, lab)
for k in range(13):
    c = L(2 + k); pc = L(1 + k); f = lambda r: f"{c}{r}"
    W[f(4)] = WEEK_W[k]; W[f(4)].fill = inp
    W[f(5)] = f"=SUM(Mensuel_12m!$B$5:$D$5)*{f(4)}/$P$4"
    W[f(6)] = f"={f(5)}*{g('aov')}*(1-{g('refund')})"; W[f(7)] = f"={f(6)}*(1-{g('vat')})"; W[f(8)] = f"={f(7)}*{g('cogs')}"
    prev_rt = f"(Hypotheses!$B$4/4.33*{g('aov')}*(1-{g('refund')}))"; prev_cg = f"({prev_rt}*(1-{g('vat')})*{g('cogs')})"
    a = f"{pc}6" if k else prev_rt; b = f"{pc}8" if k else prev_cg
    W[f(9)] = f"=Hypotheses!$G${R_REC}*{f(6)}+(1-Hypotheses!$G${R_REC})*{a}"; W[f(10)] = f"=Hypotheses!$G${R_COG}*{f(8)}+(1-Hypotheses!$G${R_COG})*{b}"
    W[f(11)] = f"={f(6)}*{g('fees')}"; W[f(12)] = f"={f(5)}*{g('exp')}"; W[f(13)] = f"={f(6)}*{g('disp')}"; W[f(14)] = f"={f(5)}*{g('ads')}"
    W[f(15)] = f"=({g('soft')}+{g('fixother')}+{g('owner')})/4.33"; W[f(16)] = f"=Hypotheses!$G${R_VAT3}" if k == 4 else 0
    W[f(17)] = f"=Hypotheses!$G${R_SUP}/4.33"
    W[f(18)] = f"={f(9)}-{f(10)}-{f(11)}-{f(12)}-{f(13)}-{f(14)}-{f(15)}-{f(16)}+{f(17)}"
    W[f(19)] = (f"=Hypotheses!$B$3+{f(18)}" if k == 0 else f"={pc}19+{f(18)}")
W.cell(21, 1, "Trésorerie minimale 13 sem."); W["B21"] = "=MIN(B19:N19)"; W.cell(22, 1, "Besoin max de financement (si ouverture = 0)"); W["B22"] = "=MAX(0,-B21)"
for r in range(5, 23):
    for cc in range(2, 16): W.cell(r, cc).number_format = "#,##0"
W.column_dimensions["A"].width = 46
# poids total pour normalisation (colonne N de la ligne 4 réservée)
W["P4"] = "=SUM(B4:N4)"
for k in range(13):
    W[f"{L(2 + k)}5"] = f"=SUM(Mensuel_12m!$B$5:$D$5)*{L(2 + k)}4/$P$4"
W["P3"] = "Total poids"
# --- Comparatif / Stress / Seuils (valeurs Python)
def dump(ws, df, title, note=""):
    ws["A1"] = title; ws["A1"].font = Font(bold=True, size=13); ws["A2"] = note
    for j, c in enumerate(df.columns, 1): ws.cell(4, j, c).font = bold; ws.cell(4, j).fill = hdr
    for i, row in enumerate(df.itertuples(index=False), 5):
        for j, v in enumerate(row, 1): ws.cell(i, j, None if (isinstance(v, float) and np.isnan(v)) else v)
    for j in range(1, len(df.columns) + 1): ws.column_dimensions[L(j)].width = 28
dump(wb.create_sheet("Comparatif"), comp, "Comparatif des 4 scénarios (valeurs calculées par fin_10_modele_tresorerie.py)", "Trésorerie d'ouverture = 0 ; rémunération hyp. 6 000/mois ; TVA payée incluse. Les formules vivantes sont dans Mensuel_12m / Sem_13 pour le scénario actif.")
dump(wb.create_sheet("Stress"), pd.DataFrame(S).round(0), "Stress tests autour du Central", "Valeurs Python (même moteur que les formules).")
dump(wb.create_sheet("Seuils"), pd.DataFrame(rows), "Seuil de rentabilité (commandes/mois) selon pub/commande et rémunération — contribution Central", f"Contribution avant pub par commande = {cpo:.1f} CHF (net HT − coût − frais − exp/prépa − litiges).")
N = wb.create_sheet("Notes"); notes = ["LIMITES", "1. Aucune donnée bancaire (BankTransaction/BankBalanceSnapshot vides) : trésorerie d'ouverture = 0 par défaut ; résultats = variation de trésorerie, pas niveau réel.",
    "2. Frais TWINT/PayPal/PowerPay/Cembra non observés (taux contractuels supposés).", "3. Expédition/préparation = forfaits du dépôt (6,5 + 8,0), pas les factures Poste/main d'œuvre.",
    "4. Rémunération 6 000 CHF/mois = hypothèse. Autres charges fixes = 0 (manquantes).", "5. TVA : TDFN 2,1 % du CA TTC (déclaration dirigeant, non vérifiée) ; aucune TVA d'import déductible ; décomptes semestriels.",
    "6. Galaxus exclu : aucune donnée de paiement/commission ; ne pas supposer qu'il finance Shopify.", "7. Saisonnalité = hypothèse issue des commandes 2024-2026 (nov ×1,4-2,0 ; déc ×2,7-2,9 vs octobre).",
    "8. Le scénario Redressement est un test de levier, pas une prévision prouvée : exige les preuves de la feuille 'Seuils' et des tests décrits dans le rapport."]
for i, t in enumerate(notes, 1): N.cell(i, 1, t)
N.column_dimensions["A"].width = 140
wb.save(T / "modele_tresorerie.xlsx"); print("saved")
base.round(0).to_csv(T / "fin_10_central_mensuel.csv", index=False); bw.round(0).to_csv(T / "fin_10_central_13sem.csv", index=False)
