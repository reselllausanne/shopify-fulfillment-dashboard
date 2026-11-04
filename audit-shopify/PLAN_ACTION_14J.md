# Plan d'action — à appliquer (14 jours, puis 8 semaines)

Rien n'est exécuté par l'audit. Tout est une recommandation (R) du dirigeant. Preuves : `RAPPORT_FINAL.md`, `analyses/ban_01_tresorerie_reelle.md`, `analyses/strat_01_*.md`.

## Semaine 1 (jours 1-7) : sécuriser

| # | Action | Pourquoi (preuve) | Coût / effort | Critère de fin |
|---|---|---|---|---|
| 1 | Demander à l'AFC l'extrait de compte TVA + confirmer la convention d'échelonnement (300 CHF/semaine, facture du 05.01.2026) ; vérifier S2-2025 et S1-2026 | 40 paiements de 300 observés, aucun versement forfaitaire fév./août ; TDFN S1-2026 ≈ 7,1 k (F+I, `ban_01` §2.6) | 1 h | solde AFC connu ; échéance chiffrée |
| 2 | Ouvrir un sous-compte « TVA/impôts » et y virer 2,1 % de chaque encaissement Shopify/Galaxus chaque semaine | pas de provision visible ; trésorerie libre ≈ 0 | 30 min | virement automatique |
| 3 | Traiter nominalement les **76 commandes bloquées** (`tableaux/commandes_prioritaires_14j_180j.csv`) : expédier, rembourser ou prévenir | 93 payées non expédiées ; risque de litiges et d'avis | 1-2 jours | 0 commande payée non expédiée > 14 j |
| 4 | Plafonner la pub : tROAS gelés 28 jours, PMax −30-35 % (≈ −4,9 k/mois), pause UGG ; ne pas ajouter de budget avant la preuve | pub 100,9 k confirmée à la banque ; contribution après pub +5,3 CHF/commande seulement | 1 h | budget Google ≈ 10 k/mois (vs 15,3 k en octobre) |
| 5 | Renouveler le jeton StockX (déconnexion), les identifiants proxy, le jeton Postmark | exposés dans des sorties d'outil pendant l'audit | 30 min | rotations faites |
| 6 | Corriger les promesses affichées : délai réel (10-13 j.o.), note d'avis, « 20 000 références », URL politique de retour | cause n°1 des litiges/remboursements | 0,5 jour | pages mises à jour |

## Semaine 2 (jours 8-14) : mesurer et décider

| # | Action | Pourquoi | Critère de fin |
|---|---|---|---|
| 7 | Mandater une fiduciaire (1-3 k) : confirmer TDFN, séparation Shopify/Galaxus/NER, TVA sur NER, AVS/impôt du dirigeant | passif TVA possible 7-23 k ; NER = exposition sur 196 k de CA | lettre de mission signée |
| 8 | Fournir les pièces restantes (`ban_01` §4) : liste des paiements du compte pro (14 ordres groupés 98,7 k), octobre, cartes sept./oct., dates de paiement Galaxus | pour clore les rapprochements | fichiers déposés |
| 9 | Relancer Galaxus sur les **≈ 126 k non encaissés** (échéances, avoirs, pénalités) ; noter le délai moyen | cash libre ≈ 2 k au 06.10 ; achats carte ≈ 29 k/semaine en septembre | calendrier d'encaissement connu |
| 10 | Fixer une règle : acheter pour Galaxus **seulement** ce qui est couvert par un encaissement attendu ≤ 30 jours | croissance août-sept. financée par la carte | plafond hebdo en vigueur |
| 11 | Décider l'écriture en base des 25 coûts retrouvés (`fin_11_backfill_proposition.csv`) : oui/non | gain 6 k TTC de précision ; non fait (lecture seule) | décision |
| 12 | Auditer BFCM (`bfcm/`, > 300 paires à −50 %) avant tout achat : marge, stock, promesse 48 h vs 10-13 j. | non audité ; point de risque majeur de nov.-déc. | go/no-go écrit |

## Semaines 3-8 : preuve avant d'accélérer

Accélérer (pub, stock, Europe) uniquement si, sur 8 semaines : contribution après pub ≥ 7 CHF/commande (ROAS global ≥ 6,5) sur cohortes mûres ; remboursements ≤ 7 % ; litiges perdus ≤ 0,5 % ; délai médian ≤ 7 jours ; coûts rapprochés (estimés ≤ 5 %) ; **TVA à jour et provisionnée** ; Galaxus encaissé dans le délai convenu. Tableau de bord : `tableaux/tableau_bord_hebdo.csv`.

## Ce qu'il ne faut pas faire maintenant
Lever des fonds ; changer de nom ; ouvrir l'Europe ; ajouter Meta/TikTok ; acheter du stock spéculatif ; baisser les prix globalement sans test.
