# Plan d'action — à appliquer (14 jours, puis 8 semaines)

Rien n'est exécuté par l'audit. Tout est une recommandation (R) du dirigeant. Preuves : `RAPPORT_FINAL.md`, `analyses/ban_01_tresorerie_reelle.md`, `analyses/strat_01_*.md`.

## Semaine 1 (jours 1-7) : sécuriser

| # | Action | Pourquoi (preuve) | Coût / effort | Critère de fin |
|---|---|---|---|---|
| 1 | Demander à l'AFC l'extrait de compte TVA, confirmer l'accord d'échelonnement (213 CHF/semaine sur S1-2026) et chiffrer les intérêts moratoires ; solder les ≈ 4 k restants | décomptes 17 295 dû, 13 247 payé ; paiements en retard sur échéances (F+I, `ban_02` §2) | 1 h | solde AFC = 0 ou plan écrit |
| 2 | Provisionner la TDFN S2-2026 (≈ 14-15 k jul.-oct. + nov.-déc.) : virer 2,1 % de chaque encaissement **Shopify et Galaxus** vers le compte « de côté » chaque semaine ; 14 000 déjà de côté sur le pro : confirmer son affectation | échéance 28.02.2027 ; Galaxus ≈ 7,6 k absent du modèle | 30 min | virement automatique |
| 3 | Traiter nominalement les **76 commandes bloquées** (`tableaux/commandes_prioritaires_14j_180j.csv`) : expédier, rembourser ou prévenir | 93 payées non expédiées ; risque de litiges et d'avis | 1-2 jours | 0 commande payée non expédiée > 14 j |
| 4 | Plafonner la pub : tROAS gelés 28 jours, PMax −30-35 % (≈ −4,9 k/mois), pause UGG ; ne pas ajouter de budget avant la preuve | pub 100,9 k confirmée à la banque ; contribution après pub +5,3 CHF/commande seulement | 1 h | budget Google ≈ 10 k/mois (vs 15,3 k en octobre) |
| 5 | Renouveler le jeton StockX (déconnexion), les identifiants proxy, le jeton Postmark | exposés dans des sorties d'outil pendant l'audit | 30 min | rotations faites |
| 6 | Corriger les promesses affichées : délai réel (10-13 j.o.), note d'avis, « 20 000 références », URL politique de retour | cause n°1 des litiges/remboursements | 0,5 jour | pages mises à jour |

## Semaine 2 (jours 8-14) : mesurer et décider

| # | Action | Pourquoi | Critère de fin |
|---|---|---|---|
| 7 | **Fiduciaire (Jurifidu, déjà mandatée)** : lui faire confirmer par écrit (a) pourquoi Galaxus et Decathlon ne figurent pas dans le CA du S1-2026 (TDFN ≈ 3 k en jeu, ≈ 10 k sur 2026), correction du décompte si besoin ; (b) traitement TVA du NER (marge) ; (c) qualification des 20 k d'apport familial (capital ou prêt) ; (d) AVS/impôt du dirigeant | `ban_02` §3, §6 | réponse écrite |
| 8 | Fournir les pièces restantes (`ban_01` §4) : liste des paiements du compte pro (14 ordres groupés 98,7 k), octobre, cartes sept./oct., dates de paiement Galaxus | pour clore les rapprochements | fichiers déposés |
| 9 | Relancer Galaxus sur les **≈ 126 k non encaissés** (échéances, avoirs, pénalités) ; noter le délai moyen | liquidités nettes de l'Amex ≈ 9 k ; achats carte ≈ 29 k/semaine en septembre | calendrier d'encaissement connu |
| 10 | Fixer une règle : acheter pour Galaxus **seulement** ce qui est couvert par un encaissement attendu ≤ 30 jours | croissance août-sept. financée par la carte | plafond hebdo en vigueur |
| 11 | Décider l'écriture en base des 25 coûts retrouvés (`fin_11_backfill_proposition.csv`) : oui/non | gain 6 k TTC de précision ; non fait (lecture seule) | décision |
| 12 | Auditer BFCM (`bfcm/`, > 300 paires à −50 %) avant tout achat : marge, stock, promesse 48 h vs 10-13 j. | non audité ; point de risque majeur de nov.-déc. | go/no-go écrit |

## Semaines 3-8 : preuve avant d'accélérer

Accélérer (pub, stock, Europe) uniquement si, sur 8 semaines : contribution après pub ≥ 7 CHF/commande (ROAS global ≥ 6,5) sur cohortes mûres ; remboursements ≤ 7 % ; litiges perdus ≤ 0,5 % ; délai médian ≤ 7 jours ; coûts rapprochés (estimés ≤ 5 %) ; **TVA à jour et provisionnée** ; Galaxus encaissé dans le délai convenu. Tableau de bord : `tableaux/tableau_bord_hebdo.csv`.

## Ce qu'il ne faut pas faire maintenant
Lever des fonds ; changer de nom ; ouvrir l'Europe ; ajouter Meta/TikTok ; acheter du stock spéculatif ; baisser les prix globalement sans test.
