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
| Marge sur lignes StockX appariées (323,0 k de CA, coût 225,2 k) | +97,8 k (30,3 %) | F pour le calcul ; **I** pour le niveau : `stockxAmount` n'est pas prouvé « rendu » (voir risque ci-dessous) |
| Marge sur lignes sourcées hors StockX (REI, BWZ, WEL…, ≈ 39 k de CA, coût ≈ 23,6 k) | ≈ +15,7 k | I |
| Marge NER (10 % du CA NER) | +19,6 k | D |
| = **contribution avant frais, TVA et lignes non appariées** | **≈ 133 k** | I/D |
| Lignes StockX sans coût (48 k de CA) à 30,3 % | +14,6 k | H |
| − frais DELR (packing 5,8 k + expédition 8,6 k, févr→nov.) | −14,4 k | F |
| − TVA TDFN ≈ 2,1 % × 1,081 × 420,8 k | −9,6 k | D |
| − TVA/impôt sur marge NER (≈ 8,1 % de 19,6 k, hypothèse haute) | −1,6 k | H |
| − retours/avoirs Galaxus | **non mesurable** (aucune table de retours Galaxus) | manquant |
| = **contribution Galaxus centrale** | **≈ 122 k** (≈ 15 k/mois) | I/D/H |
| Plancher (sans lignes non appariées, TVA haute) | ≈ 107 k (≈ 13 k/mois) | I/D |

**Correction (relecture indépendante)** : la borne haute « 137 k » de la version précédente n'était pas dérivable de ce tableau ; la fourchette lisible est **107-122 k sur 8 mois**, niveau **I/D/H** (NER et TDFN déclarés, 14,6 k de lignes non appariées à 30,3 % en hypothèse, retours Galaxus non mesurables, périodes mélangées : CA propre mars→oct, NER/STX tirés d'une table mars→2 nov). Ce n'est **pas** du cash disponible : aucun impôt sur le revenu, AVS ni provision n'est déduit (raison individuelle : le bénéfice est le revenu du dirigeant).
**I** : Galaxus génère environ 10 fois la contribution mensuelle de Shopify avant rémunération (+1,2 k/mois). Le résultat du dirigeant dépend donc surtout de Galaxus, pas de Shopify. Les volumes ont fortement monté (août-octobre : 1 308 lignes en septembre) : le risque de concentration est élevé (une seule contrepartie, délais de paiement inconnus, politique de pénalités inconnue).
**Risques non chiffrés Galaxus** : (1) *Coût `stockxAmount`* : sur 18 unités comparables à l'historique StockX, 10 ont un montant réglé = enchère seule et 8 = enchère + ≈ 28 CHF (rendu) ; si le coût Galaxus est souvent l'enchère seule, la marge de 30,3 % est surestimée de jusqu'à ≈ 28 CHF × ≈ 1 700 lignes × part « enchère seule » (≈ 56 % sur l'échantillon, n = 18) ≈ **−27 k** (**H**, échantillon minuscule : à vérifier avant tout usage). (2) *NER* : l'exposition fiscale porte sur 196 k de CA si c'est l'entreprise qui facture/encaisse (TDFN 2,1 % ≈ 4,5 k ; à 8,1 % ≈ 15,9 k, plus impôt/AVS) et pas seulement sur 19,6 k de marge : **à qualifier avec la fiduciaire avant de « garder »**. (3) *Tendance* : août-octobre ≈ 75 % du CA Galaxus ; octobre ≈ −22 % vs septembre ; « 13-15 k/mois » est une moyenne mars-octobre, pas une tendance. (4) Decathlon (421 commandes, 92 k, avril-septembre) non analysé.
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
| Favorable (volume ×1,15, coût 70 % du net, pub 30) | 4 556 | +63,8 k | −8,2 k | −0,05 k |
| Redressement (pub 18/cmd, volume ×0,85 + 4 leviers non étayés) | 3 368 | +87,6 k | +15,6 k | +0,6 k |

**Décomposition du Redressement** (`fin_10_redressement_decomposition.csv`) : volume ×0,85 + pub 18 CHF/commande seuls donnent **−0,9 k après rémunération** ; les +16,6 k restants viennent de quatre leviers non étayés (panier +3 %, remboursements 6,5 %, litiges ÷2, expédition 13 CHF). Avec ces leviers, le point mort après rémunération est à volume ×0,70 ; à ×0,65 : −5,9 k. L'élasticité implicite (pub −56 % pour −15 % de commandes) est ≈ 0,27 contre ≈ 0,6 observé en nov-déc 2025, sans test d'incrémentalité : **enveloppe non prouvée, pas une prévision**. Le Favorable a été corrigé (coût ≤ Central) ; avant : coût 73,5 % > Central 70,8 %, illogique.

Stress (Central, `fin_10_stress.csv`) : CPC +25 % → −34,7 k ; remboursements +4 pts et litiges ×2 → −16,6 k ; pic manqué (−35 % sur nov-janv) → −2,8 k ; réserve Shopify Payments 14 jours → trésorerie minimale 13 semaines −42,9 k ; combiné → −47,3 k.
**I** : le besoin de fonds de roulement de Shopify est faible **pour Shopify Payments seul** (encaissement ≈ 4 jours, achat StockX payé à J+5) ; il n'est pas observable pour TWINT/PayPal/PowerPay/Cembra (≈ 50 % des commandes) et le stress « réserve Shopify Payments 14 jours » donne un point bas de −42,9 k : le risque de BFR est réel si Shopify Payments retient des fonds. Le vrai risque est la perte de contribution (pub, remboursements) et les réserves de paiement, pas l'achat de stock. Décomptes TDFN semestriels : ≈ 6,1 k + nov-déc modélisés (≈ 18 k sur 12 mois, central).
Limites du classeur : formules sans valeurs en cache (calcul à l'ouverture dans Excel ; LibreOffice absent), onglets `Comparatif`/`Stress` figés depuis Python, ouverture = 0, charges fixes réelles = 0 (voir `donnees_manquantes` : ordre de grandeur **H** 0,5-1,5 k/mois, soit 5-15 k sur 10 mois, du même ordre que le résultat de 11,9 k), TDFN du S1-2026 (≈ 7,1 k, échéance fin août 2026) hors modèle, saisonnalité nov ×1,6 / déc ×2,5 calée sur 2025 où la pub avait aussi été poussée.

## 5. Financement (S18) — aucune démarche, aucun contact
Besoin chiffré : **non démontré**. Shopify n'a pas de fonds de roulement structurel à financer ; l'argent manquant n'est pas connu faute de relevés. Le seul besoin plausible est un coussin de sécurité (3 mois de charges ≈ 15-25 k CHF avec rémunération) et un éventuel stock pilote ≤ 4 k CHF.
Options (sources et limites) :
1. **Autofinancement via Galaxus** (même entité) : possible si les paiements Galaxus sont connus ; risque de concentration et de mélange des comptes (pas de séparation juridique ni comptable prouvée).
2. **Cautionnement romand** ([cautionnementromand.ch](https://www.cautionnementromand.ch/fr/le-cautionnement.html), consulté 2026-11-02) : caution max 1 M CHF, amortissement ≤ 10 ans, frais : inscription 300, expertise 1 % (500-2 700), prime 1,25 %/an, gestion 250/an ; bénéficiaires FR/GE/NE/VS/VD ; comptabilité régulière exigée. À vérifier : éligibilité d'une raison individuelle, inscription au registre du commerce (CA > 100 k CHF → inscription obligatoire, [KMU](https://www.kmu.admin.ch/fr/registre-du-commerce-son-fonctionnement)), exigence de comptabilité.
3. **Crédit bancaire** (UBS ou autre) : non consulté ; garanties personnelles probables pour une raison individuelle (**H**).
4. **Revenue-based financing / avances sur ventes** (Shopify Capital, etc.) : disponibilité en Suisse non vérifiée ; coût effectif à comparer (**H**).
5. **Business angel / capital** : impossible dans une raison individuelle ; exigerait une Sàrl/SA (avis fiduciaire/juriste requis, hors mandat). Illustration non recommandée : lever 100 k CHF à 500 k CHF de pré-money = 16,7 % de dilution ; sans trajectoire de profit prouvée la valorisation n'est pas défendable.
**R** : pas de levée de fonds ni de dette avant (a) comptabilité et relevés reconstitués, (b) séparation Galaxus/Shopify, (c) contribution Shopify après pub ≥ 20 CHF/commande sur 8 semaines, (d) décision sur la structure juridique. Documents bancaires attendus : relevés UBS 24 mois, cartes, PayPal/TWINT/PowerPay/Cembra, décomptes TVA TDFN, factures Poste.

## 6. Sourcing comparé (S5.6) — partiel
| Mode | Preuve interne (F) | Prix/marge | Délai | Risque/garantie | Verdict |
|---|---|---|---|---|---|
| Achat StockX après commande (88 % du CA Shopify) | 2 340 lignes 2026 ; coût = enchère + ≈ 28 CHF ; marge affichée 31,1 % | contribution 40,3 CHF/cmd après TDFN | 10-13 j.o. médian (cron + attente) ; 179 achats annulés sur 6 004 (3 %) | authenticité StockX ; annulations avant expédition 40 % des remboursements ; retours non négociés à l'achat (cf. SneakerHype) | cœur actuel, à réparer (délais) |
| Fournisseurs alternatifs (REI, BWZ, WEL, TUS, XNT, VEN… via `SupplierVariant`) | Utilisés côté Galaxus : ≈ 39 k de CA, coût 23,6 k, marge ≈ 40 % | marge plus haute, volumes faibles | non mesuré | garanties/authenticité non auditées ; comparabilité Shopify non testée | à tester sur 1-2 familles (non fait) |
| Réseau de revendeurs | non mesuré | — | — | — | non traité (aucune donnée) |
| Stock propre ciblé | 692 lignes (50 k TTC), coût déclaré | contribution hoodie ≈ 67, tee ≈ 16 | 2-5 j.o. attendus | stock immobilisé, rotation inconnue | pilote ≤ 4 k (cf. §3) |
| Hybride (stock sur 20 modèles + StockX sinon) | 20 modèles = 13 % des unités | — | — | — | option recommandée, limitée |
Limites : pas de comparaison de prix concurrents par référence exacte (S5.3 non traité : aucun GTIN/SKU rapproché ni scraping concurrent), pas de devis fournisseurs, pas de données de dépôt-vente (S6.6).
