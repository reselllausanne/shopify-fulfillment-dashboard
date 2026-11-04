"""Classe les mouvements UBS 2026 (BUS + PERS) par nature, mensuel. Sorties locales : donnees_banque_local/ban_02_classes.csv ; agrégats publiables : tableaux/ban_02_*.csv (sans IBAN ni noms de particuliers hors catégories)."""
import pandas as pd, re, pathlib
R = pathlib.Path(__file__).resolve().parents[1]; LOC = R / "donnees_banque_local"; T = R / "tableaux"
d = pd.read_csv(LOC / "ban_01_mouvements.csv"); d["d"] = pd.to_datetime(d.date, format="%d.%m.%Y"); d["mois"] = d.d.dt.strftime("%Y-%m")
RULES = [  # (catégorie, regex sur description+détail, sens: 1 entrée / -1 sortie / 0 les deux)
 ("in_galaxus", r"DigitecGalaxus", 1), ("in_decathlon_lemonway", r"Lemonway", 1),
 ("in_shopify_stripe", r"StripePaymentsUK", 1), ("in_shopify_twint", r"TWINTAcquiring", 1), ("in_shopify_mfgroup", r"MFGroup", 1),
 ("in_shopify_paypal", r"PAYPALPTELTD", 1), ("in_sumup", r"SUMUP", 1),
 ("int_proprietaire", r"theomanzinali|TheoManzinali|SolutionsManzinali|Manzinali,?Theo", 0),
 ("fin_carte_swisscard", r"Swisscard", -1), ("fin_carte_corner", r"CORNERBANCA|CORNERCARD|Cornèr", -1),
 ("out_ner_jordan", r"JordanNerny|NERNY,?JORDAN", -1), ("in_ner_jordan", r"NERNY,?JORDAN", 1),
 ("out_paiements_groupes", r"ordreglobale-banking", -1),
 ("out_logistique", r"PostCH|SwissPostCargo|FedEx|DHL|PostBilling|UPS|Tenso", -1),
 ("out_taxes_afc_douane", r"Administrationfédérale|AFC|Douane", -1), ("out_etat_cantonal", r"EtatdeVaud|Etatde|Administrationcantonale|Impôts|Préfecture|SecuritéRiviera|Sécurité", -1),
 ("out_assurance_sante", r"Atupri|Baloise|Assurance|Helsana|Visana|Swica|AXA|Zurich", -1),
 ("out_logiciels_outils", r"SHOPIFY|CURSOR|VERCEL|SUPABASE|KICKSDB|OPENAI|CHATGPT|GOOGLE|Klaviyo|Postmark|HETZNER|Namecheap|GitHub|Notion|Apple|Judge|Simprosys|ADC", -1),
 ("out_stockx_goat_direct", r"StockX|STOCKXX|GOAT", -1),
 ("out_frais_bancaires", r"Soldedécompte|Fraisdetiers|Fraisdetenue|Prixprestation", -1),
 ("out_freelance_zhao_etc", r"JIMMYZHAO|Jimmyzhao|KUANKAI|PANAV|Panavgupta|OCEKIK", -1),
 ("out_eo_switzerland", r"EOSwitzerland", -1), ("out_visa_viseca", r"Viseca", -1), ("out_revolut", r"Revolut", -1),
]
def cl(r):
    s = (r.desc + " " + str(r.detail)).replace(" ", "")
    for cat, rx, sg in RULES:
        if re.search(rx, s, re.I) and (sg == 0 or (sg == 1 and r.amount > 0) or (sg == -1 and r.amount < 0)): return cat
    return "in_autre" if r.amount > 0 else "out_autre"
d["cat"] = d.apply(cl, axis=1); d.to_csv(LOC / "ban_02_classes.csv", index=False)
piv = d.pivot_table(index="cat", columns="acct", values="amount", aggfunc="sum").fillna(0).round(0); piv["TOTAL"] = piv.sum(axis=1)
print(piv.sort_values("TOTAL").to_string())
m = d.pivot_table(index="mois", columns="cat", values="amount", aggfunc="sum").fillna(0).round(0)
m.to_csv(T / "ban_02_flux_mensuels_par_categorie.csv"); piv.to_csv(T / "ban_02_flux_par_categorie.csv")
print(d[d.cat.isin(["out_autre"])].assign(cp=lambda x: x.desc.str.replace(r";.*", "", regex=True).str.slice(0, 32)).groupby(["acct", "cp"]).amount.agg(["size", "sum"]).sort_values("sum").head(35).round(0).to_string())
print(d[d.cat.isin(["in_autre"])].assign(cp=lambda x: x.desc.str.replace(r";.*", "", regex=True).str.slice(0, 32)).groupby(["acct", "cp"]).amount.agg(["size", "sum"]).sort_values("sum", ascending=False).head(15).round(0).to_string())
