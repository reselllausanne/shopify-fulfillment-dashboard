# Galaxus, stock pilote, trésorerie, financement (S4.17, S6, S17, S18)

Devise CHF, HT sauf mention, période 2026-03 → 2026-10 pour Galaxus. Niveaux : **F** fait, **D** déclaré par le dirigeant (non prouvé), **H** hypothèse, **I** interprétation, **R** recommandation. Voir aussi `fin_00_base_financiere.md`, `tableaux/modele_tresorerie.xlsx`.

## 1. Faits d'entité (F + D)
- Une seule entité juridique : Solutions Manzinali, **raison individuelle** (responsabilité personnelle illimitée), assujettie TVA, même numéro pour Shopify et Galaxus. « Galaxus finance Shopify » signifie donc : même patrimoine du dirigeant (F).
- TVA : taux forfaitaire (TDFN) **2,1 % du CA TTC** (**D** ; aucun décompte AFC ni relevé bancaire consultable). Pas de TVA d'entrée déductible (**I** : conséquence du forfait).
- NER : 196 327 CHF de CA Galaxus HT (1 395 lignes) qui ne sont **pas** du chiffre d'affaires propre : le CA est redirigé à un ami, le dirigeant garde 10 % de marge brute, TVA payée sur ce seul bénéfice (**D**). Contribution NER = ≈ 19,6 k CHF (**D**, base 10 % × 196,3 k ; qui expédie et qui supporte retours/litiges non connu).

## 2. Galaxus : contribution estimée mars→octobre 2026
Source : `donnees_brutes/05_galaxus_*.csv`, `05_galaxus_costs_returns.csv`. Les avoirs Galaxus (ex. Gutschrift 86563518) montrent que Galaxus achète à prix HT + TVA 8,1 % : le CA enregistré est le prix de vente fournisseur, sans commission séparée (**I** à confirmer par les décomptes de paiement, absents).

| Poste | CHF | Niveau |
|---|---|---|
| CA propre HT (617 k − NER 196 k) | 420,8 k | F |
| Marge sur lignes StockX appariées (323,0 k de CA, coût 225,2 k) | +97,8 k (30,3 %) | F |
| Marge sur lignes sourcées hors StockX (REI, BWZ, WEL…, ≈ 39 k de CA, coût ≈ 23,6 k) | ≈ +15,7 k | F |
| Marge NER (10 % du CA NER) | +19,6 k | D |
| = **contribution prouvable ou déclarée (plancher)** | **≈ 133 k** | |
| Lignes StockX sans coût (48 k de CA) à 30,3 % | +14,6 k | H |
| − frais DELR (packing 5,8 k + expédition 8,6 k, févr→nov.) | −14,4 k | F |
| − TVA TDFN ≈ 2,1 % × 1,081 × 420,8 k | −9,6 k | D |
| − TVA/impôt sur marge NER (≈ 8,1 % de 19,6 k, hypothèse haute) | −1,6 k | H |
| − retours/avoirs Galaxus | **non mesurable** (aucune table de retours Galaxus) | manquant |
| = **contribution Galaxus centrale** | **≈ 122-137 k** (≈ 15-17 k/mois) | I |
| Plancher (sans lignes non appariées, TVA haute) | ≈ 107 k (≈ 13 k/mois) | I |

**I** : Galaxus génère environ 10 fois la contribution mensuelle de Shopify avant rémunération (+1,2 k/mois). Le résultat du dirigeant dépend donc surtout de Galaxus, pas de Shopify. Les volumes ont fortement monté (août-octobre : 1 308 lignes en septembre) : le risque de concentration est élevé (une seule contrepartie, délais de paiement inconnus, politique de pénalités inconnue).
Cash libre généré par Galaxus : **non calculable** sans délais de paiement Galaxus, relevés bancaires et pénalités. Conversion contribution→cash exige : délai de règlement Galaxus, achats StockX payés (5 jours), retours.
Synergies : stock/avoirs/retours Shopify et Galaxus passent par la même chaîne StockX ; soldes = retours revendus. Aucune preuve que Galaxus et Shopify se concurrencent sur les mêmes références (non testé, ne pas présumer).
Coût d'opportunité : le temps de support/expédition Shopify (≈ 11 jours de délai moyen, 180 commandes à contrôler) pèse sur un dirigeant seul ; chaque heure Galaxus rapporte beaucoup plus qu'une heure Shopify à la marge (**I**).

## 3. Stock pilote (S6) — aucune commande d'achat passée
Faits :
- La paire est rarement achetée avant la vente (**D**) ; achat différé de 5 jours par défaut (cron « cashflow lag »).
- Demande Shopify très dispersée : 1 633 modèles vendus en 2026, 9 modèles ≥ 10 unités représentent 9,9 % des unités ; les 20 premiers 13,4 %. Un stock ne peut couvrir qu'une minorité des ventes.
- Stock propre actuel : 692 lignes (50 k CHF TTC) dont soldes ; coûts déclarés non prouvés. Hoodie Essentials 129 CHF / coût 42 : contribution ≈ 67 CHF avant pub (TDFN, frais 2,8 %, exp 14,05) ; tee 59 CHF / 26 : ≈ 16 CHF ; boxers 49/20 : ≈ 12,5 CHF (forfait d'expédition 14 CHF pèse sur les petits tickets).
- Soldes = retours revendus à −30 % du buy now StockX (**D**) : valorisation de ce stock = coût de l'achat initial récupéré, à suivre unité par unité (`LocalStockLot` : 36 lots seulement depuis juillet).

Avantage attendu d'un stock : **délai** (2-5 jours ouvrés contre 10-13), donc moins d'annulations avant expédition (40 % des remboursements 2026 = 22,8 k CHF), moins de litiges « produit non reçu » (8 sur 35), meilleur taux de conversion potentiel. Le prix d'achat ne baisse pas (même source StockX), sauf achat en lot/promo non démontré. Gain annuel plausible : 5-15 k CHF sur le périmètre couvert (**H**, non prouvé).
**R** (pilote, à décider, jamais lancé par l'audit) :
- Périmètre : 5 à 8 modèles déjà vendus ≥ 10 fois en 12 mois, taille par taille selon les ventes passées, au plus 2 à 3 semaines de ventes par référence.
- Budget plafond : ≤ 4 000 CHF de stock immobilisé (≈ 9 jours de contribution Galaxus plancher) ; perte maximale acceptée à définir par le dirigeant.
- Mesure : délai commande→expédition, annulations, taux de conversion, remboursements, contribution après pub, rotation (jours de stock), prix réalisé vs buy now.
- Sortie : −20 % après 45 jours, −30 % (soldes) après 75 jours ; liquidation via Galaxus ou soldes.
- Critère de poursuite : rotation ≤ 30 jours, contribution ≥ 40 CHF/paire après pub et frais, réduction mesurable des annulations. Scénario adverse : 40 % du stock invendu à −30 % = perte ≈ 600 CHF sur 4 000.
- Retour sur capital attendu (central) : 40-60 CHF par paire en 3-4 semaines sur ≈ 130 CHF immobilisés, soit ≈ 30-45 % par rotation avant coûts de pub, sous hypothèse de rotation non démontrée.

## 4. Trésorerie (S17) — `tableaux/modele_tresorerie.xlsx`
Limites : aucune donnée bancaire (`BankTransaction`, `BankBalanceSnapshot` vides ; pas d'export UBS, pas de connexion bancaire, pas de session ouverte) ; trésorerie d'ouverture = 0 ; rémunération 6 000 CHF/mois **H** ; autres charges fixes = 0 (manquantes) ; Galaxus exclu.
Résultats Shopify seul, 12 mois nov. 2026 → oct. 2027 (`fin_10_scenarios.csv`) :

| Scénario | Commandes | Résultat avant rémun. | Après rémun. 6 000 | Trésorerie min. 13 sem. |
|---|---|---|---|---|
| Prudent (volume ×0,85, pub 42/cmd) | 3 368 | −56,1 k | −128,1 k | −33,0 k |
| Central (pub 35/cmd) | 3 962 | **+16,9 k** | −55,1 k | −4,3 k |
| Favorable | 4 556 | +29,3 k | −42,7 k | −1,2 k |
| Redressement (pub 18/cmd, volume ×0,85, remb. 6,5 %) | 3 368 | +87,6 k | **+15,6 k** | +0,6 k |

Stress (Central, `fin_10_stress.csv`) : CPC +25 % → −34,7 k ; remboursements +4 pts et litiges ×2 → −16,6 k ; pic manqué (−35 % sur nov-janv) → −2,8 k ; réserve Shopify Payments 14 jours → trésorerie minimale 13 semaines −42,9 k ; combiné → −47,3 k.
**I** : le besoin de fonds de roulement de Shopify est faible (encaissement ≈ 4 jours, achat StockX payé à J+5 : cycle de trésorerie proche de zéro). Le vrai risque est la perte de contribution (pub, remboursements) et les réserves de paiement, pas l'achat de stock. Décomptes TDFN semestriels : ≈ 6,1 k + nov-déc modélisés (≈ 18 k sur 12 mois, central).
Le scénario Redressement est un test de leviers (pub ÷2, remboursements −2 pts, litiges ÷2) et non une prévision.

## 5. Financement (S18) — aucune démarche, aucun contact
Besoin chiffré : **non démontré**. Shopify n'a pas de fonds de roulement structurel à financer ; l'argent manquant n'est pas connu faute de relevés. Le seul besoin plausible est un coussin de sécurité (3 mois de charges ≈ 15-25 k CHF avec rémunération) et un éventuel stock pilote ≤ 4 k CHF.
Options (sources et limites) :
1. **Autofinancement via Galaxus** (même entité) : possible si les paiements Galaxus sont connus ; risque de concentration et de mélange des comptes (pas de séparation juridique ni comptable prouvée).
2. **Cautionnement romand** ([cautionnementromand.ch](https://www.cautionnementromand.ch/fr/le-cautionnement.html), consulté 2026-11-02) : caution max 1 M CHF, amortissement ≤ 10 ans, frais : inscription 300, expertise 1 % (500-2 700), prime 1,25 %/an, gestion 250/an ; bénéficiaires FR/GE/NE/VS/VD ; comptabilité régulière exigée. À vérifier : éligibilité d'une raison individuelle, inscription au registre du commerce (CA > 100 k CHF → inscription obligatoire, [KMU](https://www.kmu.admin.ch/fr/registre-du-commerce-son-fonctionnement)), exigence de comptabilité.
3. **Crédit bancaire** (UBS ou autre) : non consulté ; garanties personnelles probables pour une raison individuelle (**H**).
4. **Revenue-based financing / avances sur ventes** (Shopify Capital, etc.) : disponibilité en Suisse non vérifiée ; coût effectif à comparer (**H**).
5. **Business angel / capital** : impossible dans une raison individuelle ; exigerait une Sàrl/SA (avis fiduciaire/juriste requis, hors mandat). Illustration non recommandée : lever 100 k CHF à 500 k CHF de pré-money = 16,7 % de dilution ; sans trajectoire de profit prouvée la valorisation n'est pas défendable.
**R** : pas de levée de fonds ni de dette avant (a) comptabilité et relevés reconstitués, (b) séparation Galaxus/Shopify, (c) contribution Shopify après pub ≥ 20 CHF/commande sur 8 semaines, (d) décision sur la structure juridique. Documents bancaires attendus : relevés UBS 24 mois, cartes, PayPal/TWINT/PowerPay/Cembra, décomptes TVA TDFN, factures Poste.
