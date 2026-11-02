"""Décompose le scénario Redressement par levier (relecture indépendante, d-1). Sortie : tableaux/fin_10_redressement_decomposition.csv"""
import importlib.util, io, contextlib, pandas as pd, pathlib
here = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("m", here / "fin_10_modele_tresorerie.py"); m = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()): spec.loader.exec_module(m)
R, C = m.P_of(3), m.P_of(1)
def res(P): d = m.engine(P); return d.resultat_avant_remun.sum(), d.resultat_apres_remun.sum(), d.flux.sum()
rows = []; P = dict(C); label = "Central (référence)"; rows.append((label, *res(P)))
for k, lab in [("vol", "+ volume ×0,85"), ("ads", "+ pub 18 CHF/commande"), ("aov", "+ panier +3 % (non étayé)"), ("refund", "+ remboursements 6,5 % (non étayé)"), ("disp", "+ litiges ÷2 (non étayé)"), ("exp", "+ expédition 13 CHF (non étayé)")]:
    P[k] = R[k]; rows.append((lab, *res(P)))
for v in [0.75, 0.70, 0.65]:
    Q = dict(R); Q["vol"] = v; rows.append((f"Redressement complet, volume ×{v}", *res(Q)))
pd.DataFrame(rows, columns=["étape (cumulative)", "résultat avant rémunération 12 m", "résultat après rémunération 12 m", "flux net 12 m"]).round(0).to_csv(here.parent / "tableaux" / "fin_10_redressement_decomposition.csv", index=False)
print(pd.read_csv(here.parent / "tableaux" / "fin_10_redressement_decomposition.csv").to_string())
