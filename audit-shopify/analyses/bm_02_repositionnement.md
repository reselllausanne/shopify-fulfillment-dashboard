> **ERRATUM 2026-11-02 23:30 (pilote).** Les chiffres de ce fichier reposent sur une TVA de 8,1 % extraite des prix. Le dirigeant déclare le forfait TDFN 2,1 % du CA TTC (non prouvé, relevés inaccessibles). Lire : contribution avant pub **40,3 CHF/commande** (et non 28,8), ROAS global d équilibre **≈ 5,4** (et non 7,6), résultat 2026 avant rémunération **+11,9 k CHF** (et non −21,2 k). Les conclusions « la pub dépasse la contribution » deviennent « la pub marginale (≈ 42-75 CHF/commande) dépasse la contribution unitaire (40,3) ; la moyenne reste légèrement positive ». Voir `fin_00_base_financiere.md`.

# bm_02 — Repositionnement, options 1–5 et évaluation du changement de nom

Sous-agent n°3 — mandat BRIEF_MAITRE §13. Date de consultation des sources : **2026-11-02**. Lecture seule ; aucun tiers contacté ; aucune réservation de nom/domaine/identifiant.
Ceci n'est **pas** un avis juridique (marques, droit des sociétés, fiscalité) : à faire valider par un conseil en propriété intellectuelle et un juriste.

Légende : **[I]** interne · **[O]** source officielle · **[T]** estimation d'outil (Ahrefs) · **[W]** constat sur le site public · **[H]** hypothèse (non sourcée, à valider). Les chiffres « fin_00 » viennent de `analyses/fin_00_base_financiere.md` ; ceux de « bm_options_base » de `tableaux/bm_options_base.csv` (script `calculs/bm_data_02_options.py`).

## 0. Verdict

1. **Le problème n'est pas le nom, c'est l'économie unitaire.** Contribution avant publicité 28,8 CHF/commande ; publicité 35,0 CHF/commande ; contribution après acquisition **−6,2 CHF/commande** ; résultat avant rémunération **−21,2 k CHF** sur 2026-01→10 (fin_00) **[I]**. Aucun nom, logo ni vidéo ne change ces chiffres. Les 168 commandes ajoutées entre octobre 2025 et octobre 2026 ont coûté ≈ 70 CHF de publicité chacune contre 28,8 CHF de contribution (fin_00 §4, lecture confondue par la saisonnalité).
2. **La valeur actuelle de l'entreprise** tient à quatre choses vérifiables : un volume (≈ 3 560 commandes/12 mois, 99 % en Suisse), une promesse de choix (98 521 produits, 88,5 % du CA en achat à la commande StockX), un noyau de marques (Nike+Jordan+adidas 57,3 % du CA ; ASICS/NB/UGG/Saucony/Onitsuka 18,7 % ; LEGO+Swatch 10,3 % ; Fear of God 5,5 %), et un stock propre à marge affichée élevée mais **non prouvée** (voir §1). Aucune ne dépend du nom.
3. **Séquence recommandée (hypothèse)** : **Option 1 d'abord** (réparer l'économie et les promesses, garder la marque), en y incluant un **volet « option 5 minimal »** (couper la publicité marginale à rendement négatif, réduire l'assortiment actif). Ensuite seulement : tests étroits d'option 2 (stock ciblé) et 3 (réseau de fournisseurs). Option 4 (Europe) après validation (bm_05). Option 5 complète (réduire/pivoter) comme **règle d'arrêt** si l'option 1 échoue.
4. **Changement de nom** : non recommandé comme première réponse. Il ne résout aucun problème de sourcing, prix, marge ou service. Coût de perte connu : requête de marque ≈ 17,9 % du trafic estimé du top-40 [T], ≈ 410 avis Judge.me, ≈ 525 domaines référents ; bénéfices non démontrés. Le seul argument fort possible (extension DACH/Europe, marque géographique « Lausanne » + mot descriptif « Resell » peu protégeable) est **hypothétique** et ne se teste qu'après l'option 1 (§6).
5. **Disponibilité des noms/marques** : le test de la marque actuelle et de tout nom candidat n'a **pas** pu être fait dans les registres (Swissreg, TMview/EUIPO, WIPO sont des applications interactives non consultables ici). Seules ont été faites des vérifications RDAP de domaines et une recherche web. Aucune conclusion sur la protégeabilité n'est tirée (§5).

---

## 1. Ce que les données internes disent de la clientèle et de l'offre (base de la matrice)

| Dimension | Donnée [I] | Source |
|---|---|---|
| Volume | 3 529 commandes CH sur 12 mois ; panier moyen CH 224,8 CHF ; mois 2026-10 : 346 commandes, 87,5 k CHF conservé, panier 252,8 | `bm_mix_pays.csv`, `bm_mix_mensuel.csv` |
| Fourchette de prix | 150–300 CHF = 57,4 % des unités et 57,5 % du CA ; < 150 CHF = 30,6 % des unités mais 13,2 % du CA ; > 500 CHF = 3,9 % des unités, 15,0 % du CA | `bm_options_base.csv` |
| Marques (12 mois, lignes avec marque) | Nike+Jordan+adidas 57,3 % ; ASICS+NB+UGG+Saucony+Onitsuka 18,7 % ; LEGO+Swatch 10,3 % ; Fear of God 5,5 % | idem |
| Sourcing (2026-01→10) | StockX à la commande 88,5 % du CA ; stock propre/fixe 8,1 % ; autre/manuel 3,5 % | idem |
| Marge affichée par type (tableau de bord, **surestimée**) | StockX 31,1 % ; stock propre 77,4 % ; autre 45 % ; marge réalisée globale 25,2 % du net HT (fin_00) | fin_00 §5, bm_options_base |
| Récurrence | 88,5 % du CA vient de la première commande ; 8,5 % de la 2e ; 3,0 % de la 3e ; réachat à 365 j ≈ 9,6 % (cohorte 2025) ; contribution récurrent 47 CHF vs nouveau 28 CHF | `bm_mix_recurrence.csv`, fin_00 §5 |
| Langue d'atterrissage | DE 32,9 % ; FR 27,7 % ; EN 16,3 % ; inconnu 23,1 % | `bm_mix_langue_landing.csv` |
| Acquisition (première visite) | Google non étiqueté SEO (surtout Ads) 45,4 % ; SEO 11,2 % ; ChatGPT 1,3 % | `bm_mix_source_first_visit.csv` — à confirmer avec l'analyse publicité |
| Délais | commande→expédition médiane 9–14 jours (p90 14–22) ; 26 des 35 litiges perdus ; 8 cas « produit non reçu » coïncidant avec 10–13 jours | fin_00 §6–7 |
| Paiements | Shopify Payments, TWINT, PowerPay, PayPal, Cembra ; contribution/commande 23,7 (PayPal) à 32,6 (Shopify Payments) ; remboursements 5,6–10,1 % | fin_00 §5 |

**Réserves** : (a) les marges « stock propre 77 % » reposent sur des coûts unitaires **déclarés par l'utilisateur** dans le code (hoodie 42, tee 26…), non prouvés par facture ; 211 lignes de stock propre (dont 134 hoodies Essentials, 24,5 k CHF TTC) ont un coût d'appariement = 0 ; une fois valorisées, le résultat passe de −21,2 k à −28,8 k (fin_00 §1). (b) La marque est mesurée sur les lignes de commande avec fournisseur renseigné (échantillon). (c) « 88,5 % de première commande » suggère un modèle de transaction ponctuelle (pas de rétention mesurée), mais cx_04 et fin_00 portent la mesure.

**Interprétation** : la clientèle est un acheteur occasionnel, de paniers 150–300 CHF, attiré par le choix et la disponibilité de modèles recherchés, surtout via Google (payant). La preuve de fidélisation est faible (9,6 % de réachat à un an). Aucune donnée interne ne montre un besoin non satisfait qu'un nom résoudrait. **Confiance** : moyenne (données internes solides, attribution des sources non auditée).

---

## 2. Pourquoi acheter chez nous plutôt qu'ailleurs ? (état des lieux de la promesse)

- **Promesse publique [W]** : « Sneakers & Streetwear authentiques Suisse », « Plus de 20 000 références authentifiées à la main », livraison « 48H », « 589+ avis, 4,9 » (cx_03 : Judge.me seul = 410 avis, ≈ 4,66).
- **Réalité observée [I]** : 98 521 produits ; délai médian d'expédition 9–14 jours ; achat à la commande (le « produit authentifié à la main » est contrôlé après achat ; non audité ici) ; politique de retour 14 jours en avoir avec frais de 10 %.
- **Concurrence suisse documentée (bm_01)** : SN Zürich (1–3 jours), YLB Concept, Hypedstuff (sans retours), Newsole (retour 7 jours), Footshop CH (retour 30 jours), Newcop (distribution officielle, livre en CH).
- **Fait** : sur la dimension « rapidité » et « retours », au moins trois concurrents suisses documentés sont plus clairs ou plus rapides que nos délais effectifs ; sur la dimension « choix » (98 k références) nous sommes probablement avantageux ; sur la dimension « prix » nous ne disposons d'aucune comparaison systématique (non faite : accès public bloqué aux clients scriptés et aucun achat/contact autorisé).
- **Interprétation** : l'avantage défendable n'est pas le prix (marge réalisée 25 % du net HT, achat sur un marché secondaire concurrentiel). C'est **le choix + la disponibilité d'un modèle rare en Suisse sans voyage ni douane**, **à condition que le délai et les retours soient fiables**. C'est précisément ce que la promesse « 48 h » contredit aujourd'hui. **Confiance** : moyenne.

---

## 3. Options 1–5

### Option 1 — Améliorer le Shopify actuel en gardant la marque

| Élément | Contenu |
|---|---|
| **Cible** | Acheteur suisse (FR/DE) de sneakers recherchées, panier 150–300 CHF (≈ 57 % du CA) |
| **Promesse** | « Le modèle recherché, authentique, livré en Suisse avec un délai annoncé que nous tenons » (au lieu de « 48 h » non tenu) |
| **Offre** | Même catalogue ; assortiment actif réduit aux marques/segments à contribution positive (à mesurer) ; promesses publiques corrigées (bm_03 A1, A4, A6) ; délais affichés réalistes par type de sourcing |
| **Sourcing** | StockX à la commande conservé ; réduire le retard structurel (cron « cashflow lag buy » = +5 jours, fin_00 §7) ; stock propre limité aux références à rotation prouvée |
| **Service** | Délai tenu ; politique de retour lisible ; réduction des litiges « produit non reçu » (9,6 k CHF perdus) |
| **Modèle économique** | Leviers fin_00 (sensibilités sur la base −21,2 k) : exp/prépa 10 au lieu de 14,5 CHF : +12,6 k ; pub −20 % à ventes constantes : +20,2 k (illustratif) ; coûts estimés ±20 % : ±11,6 k. Aucun levier n'est prouvé |
| **Acquisition** | Plafonner la pub au rendement marginal positif (rendement d'octobre 2026 : ≈ 70 CHF de pub par commande additionnelle vs 28,8 CHF de contribution) ; SEO sur le noyau (Essentials, marque) |
| **Équipe** | Entrepreneur + support actuel ; temps de travail à chiffrer (≈ quelques heures/semaine pour le suivi des délais et des promesses **[H]**) |
| **Capital** | ≈ 0 (réallocation de temps et réduction de dépenses) |
| **Risques** | Baisse de volume en réduisant la pub ; amélioration insuffisante de la marge ; promesse de délai tenue seulement si l'achat est avancé (impact trésorerie : cron de décalage d'achat) |
| **Délai de validation** | 8 semaines (4 pour les promesses, 4 pour la lecture de la contribution) **[H]** |
| **Critères d'abandon** | Contribution après acquisition toujours < 0 après 8 semaines avec pub ≤ 18 CHF/commande ; délai médian > 10 jours malgré les corrections ; litiges perdus non réduits |

**Fait observé** : −6,2 CHF/commande après acquisition ; 71–96 % des commandes expédiées en plus de 7 jours. **Interprétation** : la promesse et l'économie sont désalignées ; corriger l'une et l'autre précède toute relance. **Hypothèse** : tenir un délai plus court améliore la conversion et réduit les litiges (non prouvé ici). **Recommandation** (mécanisme : arrêter de payer pour des clients dont la contribution est inférieure au coût d'acquisition ; réduire les remboursements en alignant promesse et exécution). **Confiance** : moyenne.

### Option 2 — Relancer une marque plus distinctive, stock ciblé et achat à la demande encadré

| Élément | Contenu |
|---|---|
| **Cible** | Acheteur de **sélection resserrée** (par ex. Essentials/streetwear, quelques sneakers cœur) ; fréquence de réachat à créer (aujourd'hui 9,6 %/an) |
| **Promesse** | « Sélection courte, prête à expédier, authentique, expédiée sous N jours » (N à définir après mesure) |
| **Offre** | 100–300 références en stock ou en achat garanti ; reste du catalogue en achat à la demande avec délai clairement annoncé |
| **Sourcing** | Stock ciblé sur ce qui se vend sans achat (Essentials : 134 hoodies vendus sur 2026-01→10 selon fin_00) ; fournisseurs additionnels (non identifiés ici) |
| **Service** | Expédition < 3 jours pour le stock ; retours selon une politique unique |
| **Modèle économique** | Marge affichée du stock propre 77 % **non prouvée** (coût déclaré, 211 lignes à coût 0). Contribution réelle à mesurer sur 2–3 références avant d'élargir ; ce que le tableau de bord montre ne prouve rien (fin_00 §2) |
| **Acquisition** | Organique d'abord (SEO Essentials déjà en position 1 sur « essentials hoodie », volume 1 400 [T]) ; paid seulement si contribution > coût |
| **Équipe** | Entrepreneur ; temps d'approvisionnement/stock (non chiffré) |
| **Capital** | Ordre de grandeur **[H]** : 134 hoodies/10 mois × 3 mois de stock × 42 CHF ≈ 1,7 k CHF pour ce seul segment ; à extrapoler avec prudence ; risque d'invendus |
| **Risques** | Stock immobilisé, invendus, baisse de prix de revente (cause d'échec documentée : SneakerHype, The Sneaker Store dont le résultat brut est devenu négatif en 2025 — bm_01) |
| **Délai de validation** | 8–12 semaines sur 2–3 références **[H]** |
| **Critères d'abandon** | Rotation du stock > 60 jours ; contribution réelle (coût prouvé par facture) < 15 CHF/unité ; invendu > 20 % du stock acheté **[H]** |

**Interprétation** : seul segment à marge affichée élevée, donc seul levier de marge, mais la preuve est la plus fragile. **Confiance** : faible-moyenne.

### Option 3 — Modèle hybride / réseau de fournisseurs-revendeurs plus structuré

| Élément | Contenu |
|---|---|
| **Cible** | Même clientèle, avec des paniers plus variés (aussi petits tickets et collectibles) |
| **Promesse** | « Plus de modèles disponibles rapidement » via plusieurs sources (StockX, boutiques/partenaires suisses ou UE, stock propre) |
| **Offre** | Catalogue actuel + références venant de partenaires avec stock réel |
| **Sourcing** | Réseau de revendeurs avec stock en dépôt/consignation ; **d'autres fournisseurs que StockX** (non identifiés ; non contactés) ; l'objet social inscrit de l'exploitant (« service d'intermédiaire dans la création de liens entre des entreprises et un réseau varié de revendeurs ») va dans ce sens mais ne prouve rien de l'exécution |
| **Service** | Délai variable selon la source ; nécessite une logique de disponibilité fiable |
| **Modèle économique** | Commission/marge selon le partenaire ; **aucune donnée** (non sourcée) |
| **Acquisition** | Identique ; effet attendu : meilleure disponibilité, moins d'annulations |
| **Équipe** | Plus de gestion de fournisseurs et d'intégration ; charge non chiffrée |
| **Capital** | Faible si consignation ; élevé si achat ferme **[H]** |
| **Risques** | Complexité opérationnelle et de cohérence des stocks ; la diversification en B2B/multi-source a coïncidé avec des difficultés chez Limited Resell (redressement judiciaire 07-2026 après ≈ 2,4 M€ de CA, 0,9–1,3 M€ de capitaux levés, bm_01) — cause non publiée |
| **Délai de validation** | 8–12 semaines avec 1–2 partenaires, sans élargir l'assortiment **[H]** |
| **Critères d'abandon** | Taux d'annulation partenaire > 5 % ; délai de livraison pire que l'achat StockX ; temps de gestion > 4 h/semaine pour < 10 % du CA **[H]** |

**Confiance** : faible (aucune donnée de partenaires). Le seul fait interne est la dépendance : 88,5 % du CA vient d'une seule source (StockX), donc un risque de concentration à quantifier (conditions, frais, disponibilité).

### Option 4 — Préparer une expansion européenne après validation des prérequis

Voir **bm_05** pour les calculs et sources. Résumé :

| Élément | Contenu |
|---|---|
| **Cible** | DE/AT d'abord (même langue ; DE = 32,9 % des commandes en atterrissage, demande de recherche ≈ 6 × la CH sur « adidas samba » [T]) ; FR à titre d'observation |
| **Promesse / offre** | Offre actuelle, prix rendu transparent (droit + TVA), délais réels |
| **Modèle économique** | Prix rendu ≈ +48 % vs CH TTC pour le panier moyen (droit 16,9 % + port) ; contribution avant pub ≈ 29,9 CHF en DAP, −9,2 CHF si on absorbe le droit |
| **Capital** | Pilote : temps + conseil fiscal/douane ; **aucun chiffre sourcé** (pas de devis) |
| **Risques** | Douane, refus de colis, retours (rétractation UE), politique de retour à adapter ; échecs documentés liés à la TVA/douane internationale (Restocks, Sneaker District) |
| **Délai de validation** | 90 jours, 60 commandes maximum |
| **Critères d'abandon** | Refus ≥ 10 % ; port réel > 40 CHF ; contribution < 10 CHF/commande |
| **Prérequis** | Contribution CH ≥ 0 après acquisition ; promesses et politiques corrigées (Option 1) |

**Confiance** : moyenne sur le mécanisme ; faible sur la demande.

### Option 5 — Réduire Shopify ou pivoter si l'économie ne justifie pas la relance

| Élément | Contenu |
|---|---|
| **Cible / promesse** | Conserver le noyau rentable (à identifier) ; abandonner les segments déficitaires |
| **Offre** | Assortiment réduit aux catégories à contribution positive après coûts réels (tableau fin_00 par marque, tranche de prix, sourcing) ; arrêt de la publicité à rendement négatif ; les petits tickets (< 100 CHF) sont pénalisés par l'expédition forfaitaire de 14 CHF (fin_00 §5) |
| **Sourcing** | Inchangé pour le noyau ; écoulement du stock propre résiduel |
| **Service** | Tenable avec une petite équipe |
| **Modèle économique** | À 18 CHF de pub/commande, il faut **587 commandes/mois** pour couvrir 6 000 CHF de rémunération + logiciels (309 pour 3 000) ; à 10 CHF : 337 (fin_00 §3). Niveau actuel : 283 commandes/mois (moyenne fév–oct), 348 en octobre. Donc **la rentabilité exige à la fois moins de pub par commande et plus de commandes**, ou un coût d'exploitation plus bas |
| **Acquisition** | Organique + base clients ; pub plafonnée |
| **Équipe** | Entrepreneur seul, temps réduit |
| **Capital** | Libère du capital (arrêt de pub ≈ 100,9 k CHF sur 10 mois selon fin_00) ; coût de sortie non chiffré |
| **Variantes** | (a) réduire ; (b) mettre en pause ; (c) transférer/vendre la marque, le domaine, la base clients (précédent : Kikikickz → Wethenew a racheté domaine, base de données et réseaux sociaux, bm_01) ; (d) pivoter vers une autre source de revenus (ex. Galaxus : hors périmètre) |
| **Risques** | Perte de volume ; engagements en cours (commandes payées non expédiées : 93 payées entièrement non expédiées, 23,4 k CHF, fin_00 §7) ; réputation (promesse non tenue) |
| **Délai de validation** | 12 semaines après exécution de l'option 1 **[H]** |
| **Critères d'abandon (de l'option 5, c.-à-d. de la relance)** | Option 1 exécutée, contribution après acquisition < 0 à pub ≤ 18 CHF/commande après 12 semaines et sans levier crédible restant |

**Confiance** : moyenne (les seuils de rentabilité viennent de fin_00).

### Combinaisons et séquence

| Phase | Contenu | Condition de passage |
|---|---|---|
| 0 (semaines 0–2) | Corriger les promesses et la politique de retour (bm_03 A1, A4, A6) ; couper la pub marginale la plus coûteuse (à identifier avec l'analyse publicité) | — |
| 1 (semaines 2–10) | Option 1 (et option 5 minimale) | Contribution après acquisition ≥ 0 |
| 2 (semaines 10–22) | Tests étroits options 2 et 3 (2–3 références / 1–2 partenaires) | Contribution prouvée par facture |
| 3 | Option 4 (pilote DE/AT) | Phase 1 acquise ; critères bm_05 |
| Règle d'arrêt | Option 5 complète | Phase 1 échouée |

**Fait** : le seul mois positif après publicité est octobre 2026 (+1 960 CHF) mais 12 775 CHF de ses coûts sont estimés (fin_00 §1). **Interprétation** : un seul mois ne prouve rien. **Confiance** : moyenne-faible.

---

## 4. Matrice comparative initiale (données internes ; la contribution financière détaillée viendra du pilote)

| Critère | Option 1 | Option 2 | Option 3 | Option 4 | Option 5 |
|---|---|---|---|---|---|
| Part du CA concernée (12 mois) | 100 % (noyau 150–300 CHF : 57,5 %) | 8,1 % (stock propre/fixe, 2026-01→10) ; Fear of God 5,5 % (échantillon marque, recoupe en partie le stock propre) | 88,5 % (dépendance StockX) | 1 % aujourd'hui | 100 % (réduction) |
| Capital requis | ≈ 0 | faible mais risqué (≈ 1,7 k CHF sur un segment) **[H]** | variable **[H]** | pilote : temps + conseil (non chiffré) | libère du capital |
| Effet attendu sur la contribution/commande | +4,5 CHF (exp/prépa 10 au lieu de 14,5) à plus si pub baisse ; non prouvé | marge affichée élevée, **non prouvée** | inconnu | +29,9 CHF DAP avant pub / −9,2 DDP | seuil de rentabilité abaissé (337–587 cmd/mois selon pub) |
| Délai de validation | 8 sem. | 8–12 sem. | 8–12 sem. | 90 j | 12 sem. |
| Risque principal | volume en baisse | invendus | complexité | douane, refus, retours | perte de volume, réputation |
| Preuve actuelle | fin_00 (fait) | faible | aucune | bm_05 (calculs, hypothèses de port) | fin_00 (fait) |
| Dépend du nom ? | Non | Non (au plus de la clarté de la promesse) | Non | Un nom local « Lausanne » est un frein possible hors CH (**[H]**) | Non |

---

## 5. Évaluation du changement de nom (nom, logo, identité)

### 5.1 Problème concret résolu — et problèmes qu'il ne résout pas

| Problème | Le nom/le logo le résout-il ? |
|---|---|
| Contribution après acquisition négative | Non |
| Délais et litiges (« produit non reçu ») | Non |
| Dépendance à StockX (88,5 %) | Non |
| Promesses incohérentes (20 000 références, 48 h, 4,9) | Non (se corrige sans changer le nom) |
| Faible réachat (9,6 %/an) | Pas directement |
| **Extension DE/AT/EU** : nom évoquant une ville suisse romande ; mot « Resell » anglais | **Possiblement** — **hypothèse** à tester (§5.4) |
| **Protégeabilité** : nom = mot descriptif + toponyme | **Possiblement** — **hypothèse** à vérifier par un conseil en PI |

Conclusion : **aucun** des problèmes économiques mesurés n'est causé par le nom. Le renommage n'est pertinent que pour deux motifs possibles et non prouvés (extension hors Suisse romande ; faible protégeabilité).

### 5.2 Adéquation FR / DE / EN (analyse, pas de preuve)

- « Resell » : anglais, lisible en FR/DE/EN ; connotation « revente » (même si les articles sont neufs, `itemCondition NewCondition` dans le schéma [W]).
- « Lausanne » : toponyme suisse romand ; ancrage local en FR ; 32,9 % des commandes arrivent par des pages DE (probablement Suisse alémanique) ; le site a déjà des titres DE/EN qui s'appuient sur « Lausanne CH » (bm_03 A8).
- L'adresse déclarée est à **Bussigny** (LocalBusiness [W]), pas à Lausanne ; point mineur de cohérence.
- **Aucune donnée de mémorisation ou de perception du nom par des clients n'est disponible.** Un test serait une petite enquête auprès de clients existants (≥ 30 réponses FR/DE) menée par l'entrepreneur — non réalisée ici (contact avec des tiers interdit pour ce mandat).

### 5.3 Disponibilité : ce qui a été vérifié et ce qui ne l'a pas été

| Registre / canal | Statut | Résultat |
|---|---|---|
| Domaines (RDAP) | Consulté 2026-11-02 | resell-lausanne.ch enregistré (nic.ch) ; resell-lausanne.com enregistré (GoDaddy ; titulaire non déterminé) ; resell-lausanne.fr : RDAP « not found » (non confirmé au registraire) ; .de / .eu : pas de résultat RDAP exploitable |
| Registre du commerce (Zefix) | **Non consulté directement** (application interactive). Agrégateurs publics (onlineinfo.ch, locaris.ch) qui reprennent le registre | Exploitant : **Solutions Manzinali**, raison individuelle, IDE CHE-309.864.712, Bussigny ; actif ; créée le 10.02.2023 selon locaris.ch (état du registre 30.08.2026) ; but inscrit : « service d'intermédiaire dans la création de liens entre des entreprises et un réseau varié de revendeurs » |
| Marques Swissreg / IPI | **Non consulté** (application interactive) | — |
| EUIPO (TMview) | **Non consulté** | — |
| WIPO (Global Brand Database) | **Non consulté** | — |
| Recherche web générale | Consultée | Aucune preuve d'enregistrement de « Resell Lausanne » comme marque dans les résultats ; **absence de résultat ≠ absence d'enregistrement** |
| Identifiants sociaux | **Non vérifiés** (accès automatisé non fiable ; aucun compte créé) ; l'identifiant commercial publié est « Resell_lausanne » (page contact [W]) | — |

**Constats à faire valider par un juriste** (pas des conclusions) :
- **Entité** : l'exploitant public est une raison individuelle dont le but inscrit au registre est un service d'intermédiaire entre entreprises et revendeurs, alors que l'activité visible est la vente en ligne aux consommateurs. L'alignement but inscrit/activité réelle est une question de conseil juridique, hors périmètre.
- **Dates** : `foundingDate` 2020 dans le schéma [W] ; entreprise créée le 10.02.2023 (agrégateur) ; domaine .ch enregistré en 2022 selon un outil tiers (Gridinsoft, non vérifié) : trois dates à clarifier avant toute communication publique (« depuis 2020 »).
- **Protégeabilité** : l'IPI indique que « Geographical indications can principally not be registered alone as a trade mark » et que les signes purement descriptifs sont exclus (https://www.ige.ch/en/protecting-your-ip/trade-marks/faqs ; https://www.ige.ch/en/intellectual-property/guide/trade-marks/grounds-for-refusal ; consultés 2026-11-02). Un nom « toponyme + mot descriptif » est donc potentiellement difficile à protéger **seul** ; l'IPI n'examine que les motifs absolus, il ne recherche pas les marques antérieures (même source) : une recherche d'antériorités distincte est nécessaire. **Confiance** : faible-moyenne (lecture de principes généraux, pas d'analyse du dossier).

### 5.4 Coûts, valeur conservée et valeur perdue

**Coûts officiels de dépôt (sourcés)** :

| Poste | Montant | Source |
|---|---|---|
| IPI (Suisse), dépôt jusqu'à 3 classes, 10 ans | CHF 450 (CHF 350 avec rabais en ligne de 100) ; classe supplémentaire dès la 4e : CHF 100 ; renouvellement CHF 550 ; opposition CHF 800 | https://www.ige.ch/en/protecting-your-ip/trade-marks/national-applications/costs-and-fees (état au 1.7.2024) |
| EUIPO (UE), marque individuelle en ligne | 850 EUR (1 classe) ; 2e classe 50 EUR ; dès la 3e 150 EUR par classe ; valide 10 ans | https://www.euipo.europa.eu/en/trade-marks/before-applying/fees-payments |
| Ordre de grandeur pour 3 classes (par ex. chaussures/vêtements, vente au détail, jouets/horlogerie — classes à confirmer) | ≈ 350–450 CHF (CH) + 1 050 EUR (UE) ≈ 1 330–1 430 CHF au change de 0,93 [H], **hors honoraires, recherche d'antériorités et WIPO** | calcul sur les montants ci-dessus |
| Honoraires de conseil PI, recherche d'antériorités, WIPO (Madrid), design, site, contenus, emballages, outils, communication de transition | **Non sourcés** : devis nécessaires ; aucune estimation inventée | — |

**Valeur conservée si on garde le nom** : requête de marque ≈ 17,9 % du trafic estimé du top-40 [T] ; 410 avis Judge.me + Trustpilot [I/W] ; DR 6 / 525 domaines référents actifs / 924 backlinks [T] ; citations dans les réponses d'IA (bm_03 §4) ; reconnaissance de la clientèle (base de 3,5 k commandes/an) ; adresse e-mail, redirections et Merchant Center existants.
**Valeur perdue / risquée si on change** : tout ce qui précède partiellement ; coût de migration (bm_03 §5) ; risque de baisse de confiance (avis rattachés à l'ancienne marque) ; période de double marque. Précédent : Kikikickz → Wethenew : la **valeur de la marque et de la base** peut survivre à l'entreprise, ce qui montre que le nom a un prix (bm_01).
**Ordre de grandeur de la perte SEO** : 0,8–10 k CHF de contribution selon l'hypothèse (bm_03 §5.3) ; faible comparé à la confiance, qui n'est pas mesurée.

### 5.5 Budget proportionné et test avant refonte

- **Budget proportionné** : l'entreprise a un résultat avant rémunération de −21,2 k CHF sur 10 mois (fin_00) ; un projet de marque ne peut pas être financé par l'exploitation actuelle. **Budget recommandé = 0 pour la refonte complète** tant que la contribution après acquisition n'est pas ≥ 0 ; seuls des tests peu coûteux sont admis (temps de travail + frais officiels de dépôt si une protection est jugée utile).
- **Tests de positionnement sans refonte (hypothèses)** : (1) page de collection ou micro-site « sélection » (par ex. Essentials) avec une promesse et un titre distincts ; (2) variantes de titres/promesses DE vs FR en annonces et pages d'atterrissage (mesure : conversion et contribution) ; (3) enquête client (≥ 30 réponses) sur la perception du nom ; (4) suivi 8 semaines. Coût : temps de travail (non chiffré), pas de refonte.
- **Condition pour envisager le renommage (hypothèse)** : (a) option 1 réussie ; (b) pilote DE/AT concluant mais freiné par le nom (preuve : tests §5.4 + enquête) ; (c) recherche d'antériorités favorable ; (d) validation juridique de l'entité et des marques ; (e) budget couvert par la contribution positive. Alors seulement : scénario S2 ou S4 de bm_03 §5 ; S3 (nouveau domaine) en dernier recours.
- **Brief de marque** (BRIEF §13 : à préparer *après* l'analyse des options) : non produit ici. À rédiger seulement si les conditions ci-dessus sont réunies ; contenu minimal : cible et promesse retenues (options 1–4), langues et pays, contraintes de protégeabilité, budget, calendrier hors Black Friday/Noël.

---

## 6. Recommandation synthétique

| | |
|---|---|
| **Fait observé** | Contribution après acquisition −6,2 CHF/commande ; 71–96 % des commandes expédiées en plus de 7 jours ; promesses publiques incohérentes avec la réalité ; 88,5 % du CA dépend de StockX ; réachat à 1 an ≈ 9,6 % ; marge « stock propre » non prouvée |
| **Interprétation** | Le problème est la promesse non tenue et l'économie unitaire, pas le nom ; le noyau défendable est le choix + la disponibilité en Suisse, s'il est livré de manière fiable |
| **Hypothèse** | Réduire la publicité marginale et tenir les délais améliore la contribution plus qu'un repositionnement de marque ; le nom ne devient un frein qu'à l'international |
| **Recommandation** (mécanisme : améliorer la contribution par commande avant de dépenser pour acquérir ou rebrander) | Option 1 + option 5 minimale pendant 8–10 semaines ; tests étroits options 2/3 ensuite ; pilote Europe (option 4) si prérequis ; pas de changement de nom avant ces preuves ; protéger la marque actuelle seulement après avis d'un conseil PI |
| **Confiance** | Moyenne sur le diagnostic économique (données internes) ; faible sur les options 2–4 (peu de preuves) ; faible sur le nom (registres non consultés) |

---

## 7. Limites et données manquantes

- **Marques et registres** : Swissreg, TMview/EUIPO, WIPO Global Brand Database, Zefix **non consultés** (applications interactives) ; seule une recherche web et des agrégateurs ont été utilisés ; identifiants sociaux non vérifiés. Aucun nom candidat n'a été testé : aucun candidat n'a été fourni et le mandat interdit de réserver ou d'acheter quoi que ce soit.
- **Domaines** : RDAP seulement ; titulaire du .com inconnu ; .fr « not found » non confirmé ; .de/.eu sans résultat.
- **Coûts de rebranding** (site, contenus, emballages, outils, honoraires, communication) : **aucun devis** ; je n'invente aucun montant. Seuls les frais officiels IPI/EUIPO sont sourcés (IPI : état au 1.7.2024, à revérifier).
- **Données internes** : marges de stock propre non prouvées (coûts déclarés, 211 lignes à coût 0) ; marge de marque issue d'un échantillon de lignes avec fournisseur ; attribution des sources non auditée ; octobre 2026 partiellement estimé ; cohorte de réachat limitée (2025).
- **Concurrence et prix** : aucune comparaison systématique des prix livrés (accès public bloqué aux clients scriptés ; aucun achat ni contact autorisé) ; concurrents suisses seulement documentés par bm_01.
- **Clientèle** : aucune enquête ni entretien (contact tiers interdit) ; la « raison d'acheter » est inférée de données de commande, de textes publics et du benchmark.
- **Fournisseurs alternatifs à StockX** : non identifiés ; conditions inconnues ; option 3 non chiffrable.
- **Financement** : sources de financement (dont la contribution possible de l'activité Galaxus) non traitées ici (BRIEF §18) ; aucun droit à un financement n'est affirmé.
- **Juridique** : entité, but inscrit, protégeabilité du nom, droit applicable aux ventes à des consommateurs UE : non tranchés ; avis juridique requis.
- **À fournir** : titulaire du .com ; éventuel dépôt de marque existant ; factures de stock propre ; conditions StockX ; liste de fournisseurs alternatifs ; budget maximum de test que l'entrepreneur accepte de perdre ; export GSC (bm_03).
