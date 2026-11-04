# Trésorerie réelle : relevés UBS, Swisscard, Cornèrcard (S3, S11, S17)

Dernière mise à jour : 2026-11-04 (Europe/Zurich). Source : exports fournis par le dirigeant le 2026-11-04 (PDF UBS, XLSX/XLS cartes). **Données brutes et mouvements ligne par ligne non versionnés** (`donnees_banque_local/`, exclu de git). Seuls des agrégats sont publiés (`tableaux/ban_*.csv`). Scripts : `calculs/ban_01_parse_ubs.py` → `ban_02_classer.py` → `ban_03_paiements_2025.py` → `ban_04_reconciliation.py`.

Niveaux : F = fait observé dans un relevé ; I = interprétation ; H = hypothèse. Montants en CHF, TTC (flux bancaires bruts), sauf mention.

## 1. Ce qui est couvert, ce qui ne l'est pas

| Source | Couverture | Limites |
|---|---|---|
| UBS compte professionnel (CH06) | 30.01 → 30.09.2026 ; premier mouvement mars ; solde final 1 492,92 (F) | octobre absent ; février vide ; export détaillé sans soldes (500 mouvements max) |
| UBS compte personnel (CH50) | 01.01 → 06.10.2026 ; reçoit les paiements Shopify ; paie aussi les dépenses privées | mélange pro/privé ; solde final à confirmer (≈ 6,6 k d'après mon extraction, **non vérifié**) |
| Swisscard **Amex** (n° 37…*3674) | 4 008 lignes, janv. → sept. 2026 ; carte d'achat principale (StockX/GOAT) | octobre absent |
| Swisscard **Mastercard Platinum** *6466 | 1 125 lignes, janv. → sept. 2026 ; usage mixte (≈ 8 k StockX/PayPal confirmés, reste Migros, voyages, divers) | — |
| Cornèrcard **0427 | 3 exports qui se recouvrent, janv. → août + 2 k en octobre (dédupliqués) | septembre absent |
| Listes de paiements UBS 2025 | 700 ordres exécutés, compte personnel | **sortants seulement** : pas d'encaissements, pas de compte pro, pas de cartes 2025 |
| PayPal / TWINT | pas d'extrait propre : visibles via les versements sur UBS | frais déduits avant versement |

Parseur : 3 204 mouvements 2026 dédupliqués ; continuité des soldes vérifiée par fichier (une seule rupture, août personnel).

## 2. Résultats (tous F sauf mention)

### 2.1 Le chiffre d'affaires Shopify du modèle est confirmé par la banque
Encaissements UBS janv. → sept. 2026 par canal vs CA TTC conservé du modèle (`tableaux/ban_04_recon_encaissements_shopify.csv`) :

| Canal | Modèle (TTC conservé) | Banque | Écart |
|---|---|---|---|
| Shopify Payments (Stripe) | 274 694 | 267 609 | −2,6 % (frais ≈ 2,9 % attendus) |
| TWINT | 126 980 | 127 918 | +0,7 % |
| PayPal | 29 697 | 28 517 | −4,0 % |
| PowerPay / Cembra (MF Group) | 108 793 | 96 593 | **−11,2 %** (frais, retours, impayés ou décalage : **à expliquer**) |
| **Total** | **540 164** | **520 637** | **−3,6 %** |

I : le revenu conservé du P&L est fiable au pourcent près ; le trou de 19,5 k = frais de passerelle (≈ 13-15 k, cohérent avec le modèle) + PowerPay (≈ 6-12 k). Aucune preuve de chiffre d'affaires fantôme.

### 2.2 Les coûts d'achat du modèle sont confirmés par la carte
Achats nets (débits − remboursements) Amex *3674 vs coût du modèle (COGS Shopify + coût StockX Galaxus), janv. → sept. (`ban_04_recon_couts_carte.csv`) : **575,0 k carte vs 590,4 k modèle (−2,6 %)**. Écart mensuel jusqu'à ±20 % (décalage achat/vente). Cornèrcard ajoute ≈ 7,6 k de débits PayPal*StockX.
I : le risque « coût Galaxus = enchère seule, sous-estimé de jusqu'à ≈ 27 k » (fin_01) **n'apparaît pas** dans le cash : si le modèle sous-estimait de 27 k, la carte dépasserait le modèle. La carte reste ≤ modèle. Réserve : une constitution de stock (achats non vendus) compenserait une sous-estimation ; le stock physique suivi est faible (36 lots), donc le risque est réduit mais pas annulé (H).

### 2.3 La publicité est confirmée au franc près
Google Ads débité sur Cornèrcard (`ban_04_recon_pub.csv`) : janv. 9 646 / févr. 9 000 / mars 8 266 / avr. 7 063 / mai 8 600 / juin 7 600 / juil. 8 476 / août 13 402 = **72,05 k** contre `DailyAdSpend` 72,0 k. Septembre et octobre non couverts par les exports (DB : 13,3 k + 15,3 k). Les versements vers Cornèrcard (94,2 k) couvrent la pub (100,9 k attendue) + achats PayPal.

### 2.4 Flux de trésorerie janv. → 6 oct. 2026 (deux comptes, `ban_02_flux_par_categorie.csv`)
| Entrées | CHF | Sorties | CHF |
|---|---|---|---|
| Shopify (Stripe, TWINT, MF Group, PayPal) | 540,5 k | Versements cartes Swisscard | −570,4 k |
| Galaxus (compte pro, mars → sept.) | 377,3 k | Versements Cornèrcard (pub) | −94,2 k |
| Decathlon (Lemonway, avr. → sept.) | 49,3 k | Paiements groupés e-banking (compte pro, 14 ordres) | −98,7 k |
| Autres entrées (particuliers, SumUp, divers) | 31,0 k | NER / Jordan Nerny | −83,1 k |
| | | Logistique (Poste, FedEx…) | −35,4 k |
| | | Freelances | −17,8 k |
| | | Logiciels et outils | −12,5 k |
| | | AFC (voir 2.6) | −9,9 k |
| | | Assurances, État, Viseca, Revolut, divers privés | −52,1 k |
| | | Transferts propriétaire (net) | −9,3 k |

Variation de trésorerie nette ≈ +9 k (pro +1,5 k ; personnel +7,8 k) **dont 20 k d'apport familial** (2 × 10 000 versés sur l'Amex les 16.03 et 08.04.2026, depuis une épargne personnelle ; D, courriel du 19.10) : **hors apport ≈ −11 k**. L'écart Amex versements reçus (≈ 592 k) − virements UBS (570 k) ≈ 22 k confirme ces 20 k (F). L'activité n'a pas accumulé de trésorerie en 2026 : tout est réinjecté en stock et pub, et un retard de paiement Decathlon début 2026 (D) a nécessité l'apport.

### 2.5 Rémunération réelle du dirigeant (I)
Dépenses privées payées depuis le compte personnel ≈ 52 k (assurances 9,8 k, divers 33,4 k, État 2,2 k, Viseca 3,7 k, Revolut 3,0 k) en 9,2 mois, soit **≈ 5,7 k/mois**, plus la carte *6466 (32 k, usage mixte) : fourchette **5,7 à 9,1 k/mois**. L'hypothèse de 6 000/mois du modèle (H) est donc plausible (borne basse). Avec cette rémunération, le résultat avant rémunération du P&L (≈ 0 à +12 k Shopify) ne la finance pas ; Galaxus la finance.

### 2.6 TVA et AFC (F, avec décomptes AFC reçus le 04.11 ; voir `ban_02_tva_et_liquidites.md`)
Les 40 virements hebdomadaires de 300 CHF (9,9 k en 2026) soldent des **décomptes TDFN réels** : S2-2025 (6 281,56, réf. RF82K8SM0022025…) puis S1-2026 (7 021,30, réf. RF35K8SM0012026…, 213 CHF/semaine depuis le 04.09). Le plan « d'alerte » initial (passif 7-23 k) est donc **remplacé** par un solde mesuré : voir `ban_02`.

### 2.7 Galaxus, NER, Decathlon
- Galaxus : 377,3 k encaissés mars → sept. (premier versement 8,6 k en mars, cohérent avec le démarrage). CA Galaxus facturé (HT, mars → sept.) 465,6 k ≈ 503 k TTC : **≈ 126 k pas encore encaissés au 30.09** (≈ 25 % ; délai d'encaissement de l'ordre de 4 à 8 semaines, **H** car dates de facture/paiement non appariées ligne par ligne). Conséquence : la croissance août-septembre a été payée par la carte avant l'encaissement ; **le besoin en fonds de roulement Galaxus existe** (stock acheté ≈ 78 k en septembre).
- NER : 83,1 k versés à Jordan Nerny en virements directs (compte pro, mars → sept.), plus ≥ 12,3 k dans les ordres groupés (2 070 le 06.05 et 10 210 le 03.06 : paiement par quinzaine des ventes Galaxus NER, selon le courriel à la fiduciaire) ; 1,7 k reçus. Total ≥ 95 k contre CA NER déclaré 196 k HT sur l'année (décalage d'encaissement).
- Les 98,7 k de « paiements groupés e-banking » sont **partiellement expliqués** par le courriel du 19.10 à la fiduciaire (6 ordres, 46,7 k) : paiements Amex (≈ 30,2 k), Mastercard Platinum (3,4 k, achats StockX) et Jordan Nerny. Reste ≈ 52 k (juil.-sept. surtout) non détaillé.
- Decathlon : 49,3 k reçus via Lemonway (avr. 9,1 → sept. 2,1 : flux éteint) pour 421 commandes / 92 k CHF en base (DB) : 53 %, écart de 43 k **non expliqué** (commission, retours, cible de mesure ; **hors périmètre**, signalé).

### 2.8 2025 (ordres de paiement du compte personnel, 700 lignes, `ban_03_paiements_2025.py`)
Virements vers Swisscard 122 k et Cornèrcard 121 k sur l'année (mensuel 15 à 36 k ; **décembre 126,7 k** = pic BFCM), Poste 15,4 k, AFC 3,4 k. Pas d'encaissements ni de cartes 2025 : **aucune base de comparaison 2025 du résultat** ; le tableau ne sert qu'à situer l'échelle (243 k versés aux deux cartes depuis le compte personnel en 2025 ; en 2026 : 664 k depuis les deux comptes, dont 78,5 k Cornèrcard et 369 k Swisscard depuis le compte personnel, soit 448 k : croissance d'un facteur ≈ 1,8 sur le seul compte personnel).

## 3. Effet sur les conclusions de l'audit
| Conclusion | Avant | Après |
|---|---|---|
| Revenu Shopify TTC conservé | modèle, non rapproché | **confirmé** (−3,6 % banque, expliqué par frais) |
| Pub Google Ads | DB | **confirmé** au franc (janv. → août) |
| Coûts d'achat | 6 % estimés, risque −27 k | **confirmé à ±3 %** ; risque −27 k réduit (H résiduelle stock) |
| Trésorerie libre 2026 | non calculable | **≈ 0** (+9 k) ; tout réinjecté |
| Rémunération | 6 k (H) | **5,7 à 9,1 k/mois observé** |
| TVA | 2,1 % déclaré | **2,1 % confirmé par les décomptes AFC** ; échelonné, solde ≈ 4 k ; Galaxus/Decathlon hors CA déclaré S1-2026 (H) : voir `ban_02` |
| Galaxus cash | contribution I | **≈ 126 k à encaisser** ; pas encore du cash |
| Financement | « pas aujourd'hui, besoin non démontré » | **inchangé en direction**, mais fonds de roulement Galaxus **démontré** (liquidités brutes 26 k (D) / ≈ 9 k nettes de l'Amex face à ≈ 126 k de créances Galaxus et à une TVA 2026 non provisionnée) |

## 4. Reste à fournir (court)
1. Extrait de compte AFC + décomptes TVA S2-2025, S1-2026.
2. Liste des paiements du compte professionnel 2026 (détail des 14 ordres groupés = 98,7 k).
3. Compte pro octobre ; solde exact des deux comptes au 04.11.
4. Cartes septembre (Cornèrcard) et octobre (Swisscard, Cornèrcard).
5. Factures Galaxus (dates de paiement) pour appairer créances.
