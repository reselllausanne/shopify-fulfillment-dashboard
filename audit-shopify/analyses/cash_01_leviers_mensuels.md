# cash_01 : leviers de cash mensuel (Shopify + Google Ads)

Date : 2026-11-11 (nuit). Lecture seule. F fait, I interprétation, H hypothèse, R recommandation. Base : août-octobre 2026, `fin_05_orders_pnl.csv` (base TDFN 2,1 %, non prouvée), `ads_09_*`.

## 1. Point de départ (par mois, F sauf mention)

| Ligne | CHF/mois |
|---|---|
| Commandes | 374 |
| Contribution avant pub (déjà nette de COGS, frais de paiement et 14,5 expédition + préparation par commande) | 17 060 |
| Pub Google Ads (total campagnes) | −14 010 |
| **Reste avant frais fixes** | **≈ +3 050** |
| Logiciels + outils (UBS/cartes, 12,5 k sur 9,2 mois) | ≈ −1 360 |
| Freelances (17,8 k sur 9,2 mois) | ≈ −1 930 |
| **Reste si 100 % des fixes pèsent sur Shopify (H : en réalité partagés avec Galaxus)** | **≈ −240** |

- F (DB, logs système) : frais de préparation moyen 8,0 CHF et port moyen 6,5 CHF par commande = 14,5 déjà dans la contribution.
- F : encaissements janvier-octobre : Galaxus 377 k, Decathlon 49 k, Shopify 540 k (`ban_01_tresorerie_reelle.md`). Dépenses privées ≈ 5,7 à 9,1 k par mois (`ban_01` §2.5). **Shopify + Google Ads seuls ne financent pas cette rémunération (F, calcul ci-dessus).**
- F : tables `BankTransaction`, `BankAccount`, `BankStatementImport`, `CashLedgerDaily` de la DB sont **vides** (0 ligne). Les relevés UBS/cartes ont été analysés hors DB (`ban_*`, non versionnés). `ManualFinanceEvent` (4 500 lignes, 28,1 k OUT) = journaux système de port et préparation.
- F : charges récurrentes actives marquées « business » dans la DB : Cursor 200, KicksDB 90, ChatGPT 18,55, Google One 10, OSMO 28,10, WTB 6,69 = 353 CHF/mois.

## 2. Leviers chiffrés (H, par mois, indépendants sauf mention)

| # | Levier | Calcul | Gain |
|---|---|---|---|
| 1 | Baisser la dépense vers 180-250 CHF/j (ROAS marginal ≈ 2,7 contre équilibre 4,7-5,1) | élasticité 0,65 : à 250 CHF/j perte de 17 % de la valeur Google (≈ −1,3 k de contribution), économie 2,5 k ; à 180 CHF/j perte 32 % (−2,4 k), économie 4,5 k | **+1,2 à +2,1 k** |
| 2 | Plancher de prix par ligne (170 commandes négatives en 3 mois ; dont 62 sans remboursement = −2,2 k) | éviter de vendre sous le coût d'achat | **≈ +0,7 k** |
| 3 | Remboursements : 108 commandes négatives remboursées = −7,9 k en 3 mois (après 70 % de récupération de stock supposée) ; remboursé = 8,5 % des ventes brutes | chaque point de remboursement évité = 0,87 k de CA par mois | **plafond +2,6 k (pertes à zéro) ; diviser par deux ≈ +1,3 k** (cause non analysée) |
| 4 | Prix +3 % | +2,4 k si volume stable ; positif tant que le volume ne baisse pas de plus de ≈ 12 % | **+2,4 k, risque sur volume ; tester sur un segment** |
| 5 | Réachat : 11,6 % des commandes sont des réachats (334 sur 2 882) ; une commande sans pub ≈ 45 CHF | +50 commandes de réachat par mois = +2,3 k ; chaque point de réachat sur 374 commandes = +170 | **+0,2 k par point** |
| 6 | Coût port + préparation 14,5 → 11,5 | 3 CHF × 374 | **+1,1 k** |
| 7 | Conversion du site : CVR observé 0,8 %, CVR d'équilibre d'un clic à 0,45 CHF = 1,1 à 1,4 % (`ads_04`) | doubler le CVR double le ROAS à dépense égale | non chiffrable sans test |

Risque de signe contraire (F) : 211 lignes de stock propre à coût 0 cachent ≈ −7,6 k sur 10 mois (`fin_00` ; ≈ −0,8 k par mois). Le résultat réel peut être plus bas que ci-dessus.

## 3. Ce qui reste à faire pour mesurer (rien n'est modifié en prod)

1. Mesurer l'incrémentalité (test géographique après Black Friday, Noël confond).
2. Backfill des coûts des lignes de stock propre et des retours revendus (suivi par lot).
3. Analyser les 108 commandes remboursées (taille, délai, marque, paiement).
4. Comparer la contribution par franc de capital Galaxus vs Shopify (pas encore fait).


> 12 nov : levier « +3 % de prix » écarté par le dirigeant (les prix viennent d'être baissés). Ne pas le compter dans le total.
