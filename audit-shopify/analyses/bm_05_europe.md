> **ERRATUM 2026-11-02 23:30 (pilote).** Les chiffres de ce fichier reposent sur une TVA de 8,1 % extraite des prix. Le dirigeant déclare le forfait TDFN 2,1 % du CA TTC (non prouvé, relevés inaccessibles). Lire : contribution avant pub **40,3 CHF/commande** (et non 28,8), ROAS global d équilibre **≈ 5,4** (et non 7,6), résultat 2026 avant rémunération **+11,9 k CHF** (et non −21,2 k). Les conclusions « la pub dépasse la contribution » deviennent « la pub marginale (≈ 42-75 CHF/commande) dépasse la contribution unitaire (40,3) ; la moyenne reste légèrement positive ». Voir `fin_00_base_financiere.md`.

# bm_05 — Europe : DE / FR / AT / IT / NL

Sous-agent n°3 — mandat BRIEF_MAITRE §15. Date de consultation de toutes les sources : **2026-11-02**. Lecture seule ; aucun transporteur, conseiller ou autorité contacté ; aucun devis obtenu.
Ceci n'est **pas** un avis fiscal, douanier ou juridique : les points de droit sont à valider par un fiscaliste/transitaire avant toute exécution.

Légende : **[I]** interne · **[O]** source officielle · **[S]** source sectorielle publiée · **[T]** estimation d'outil (Ahrefs) · **[H]** hypothèse de sensibilité (aucun devis) · **[W]** constat sur le site public.

## 0. Verdict

1. **L'Europe n'est pas un test de demande, c'est un test de coût d'entrée.** Le panier moyen (≈ 201,6 CHF HT, ≈ 217 EUR) dépasse le seuil de 150 EUR. Il subit donc le droit de pays tiers de **16,9 %** (code TARIC 6404 11 00, chaussures de sport) [O] puis la TVA d'importation du pays de destination. Le client final paie ≈ **+48 %** vs prix CH TTC (DE, port 30 CHF) — `tableaux/bm_eu_landed_cost.csv`.
2. **La TVA n'est pas le handicap** : les concurrents UE facturent aussi la TVA locale. Le handicap est le **droit de douane (16,9 %) + le port transfrontalier**, que la concurrence établie dans l'UE ne supporte pas sur des produits déjà en libre pratique.
3. **Si on absorbe le droit** (livraison DDP) : contribution avant pub ≈ **−9,2 CHF/commande** (DE, port réel 30 CHF) contre +28,9 en Suisse. En régime « client paie à la livraison » (DAP) : ≈ +29,9, mais avec risque de refus de colis ; avec un colis refusé = achat déjà fait (modèle achat après commande).
4. **Contribution avant publicité ≈ 24–30 CHF** en DAP à 0–5 % de refus ; la publicité actuelle coûte 35,0 CHF/commande en Suisse (fin_00) → la contribution après acquisition y est déjà négative (−6,2 CHF). **Aucun budget pub payant n'est justifiable en Europe tant que la Suisse n'est pas positive après acquisition.**
5. **Fait interne** : ≈ 31 commandes sur 12 mois hors Suisse ou non renseignées (27 pays identifiés + 4 « NA » ; ≈ 0,9 % des commandes), tirées par FR (15), dont 13 en 2026 — sans stratégie dédiée. Elles augmentent en août–octobre 2026 (DE, AT, IT, ES). C'est un signal faible, pas une preuve de demande.
6. **Incohérences à traiter avant toute ouverture** : frais de port annoncés « 10 CHF Europe » vs ≈ 31 CHF facturés ; politique de retour 14 jours en **avoir** (StoreCreditRefund, CH seulement) alors que le droit UE de rétractation implique en principe un **remboursement** (§6) ; preuve d'exportation pour l'exonération de TVA suisse non vérifiée (§5).
7. **Ordre d'entrée recommandé (hypothèse)** : (0) Suisse positive après acquisition ; (1) pilote DE + AT (+ FR) en DAP, sans publicité payante, plafond de 60 commandes ; (2) FR/IT/NL seulement si critères atteints. Stock UE / partenaire : à étudier **après** le pilote, pas avant.
8. Cohérence avec le benchmark (bm_01) : deux des trois causes d'échec récurrentes concernent l'international (TVA/douane mal traitées : Restocks, Sneaker District ; expansion multi-pays avant marge prouvée : Limited Resell, The Sneaker Store).

---

## 1. Données internes sur les commandes déjà livrées hors Suisse

Source : `tableaux/bm_mix_pays.csv`, `bm_mix_hors_ch_mensuel.csv`, `bm_mix_pays_tva.csv` (script `calculs/bm_data_01_mix.py`). Définition : « conservé » = `currentTotalPriceSet` TTC CHF, remboursements nets.

| Pays de livraison | Commandes (12 mois 2025-11..2026-10) | CA conservé (CHF) | Panier moyen (CHF) | Port facturé cumulé (CHF) |
|---|---|---|---|---|
| CH | 3 529 (99,13 %) | 793 203 | 224,8 | 1 078 |
| FR | 15 | 3 765 | 251,0 | 27,8 |
| NA (non renseigné, TVA 8,1 % appliquée) | 4 | 1 609 | 402,2 | 0 |
| AT | 3 | 1 184 | 394,8 | 30,7 |
| DE | 3 | 886 | 295,3 | 62,1 |
| NL | 3 | 696 | 231,8 | 92,1 |
| IT | 2 | 536 | 268,2 | 62,3 |
| ES | 1 | 185 | 185,5 | 30,7 |

- **Fait [I]** : 27 commandes identifiées hors CH + 4 « NA » (pays non renseigné, TVA suisse appliquée → probablement livrées en CH ; non tranché) ; panier moyen hors CH ≈ 232–395 CHF, supérieur au panier suisse. Ports facturés quand non gratuits : 30,7–31,4 CHF par commande (NL : 92,1 CHF cumulés sur 3 commandes). Mensuel : août 2026 DE 2 / FR 2 / IT 1 ; sept. AT 2 / DE 1 ; oct. AT 1 / ES 1 / FR 2 / IT 1 / NL 3.
- **Fait [I]** : ces commandes portent une TVA suisse de **0** (exportation exonérée) — mais l'exonération (art. 23 LTVA) n'est acquise que si l'exportation est **prouvée** (décision de taxation électronique e-dec Export) : *« Können sie die Ausfuhr weder mit einem der oben genannten Dokumente noch mit anderen Beweismitteln nachweisen, so müssen die Lieferungen im Inland versteuert werden. »* [O] — https://www.bazg.admin.ch/de/mehrwertsteuer-steuerbefreite-lieferung-bei-ausfuhr (consulté 2026-11-02) ; voir aussi ESTV, e-VV : https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-fachinformationen/mwst-verfahrensfragen/elektronischer-geschaeftsverkehr/elektronische-veranlagungsverfuegung.html.
  - **Interprétation** : si les envois n'ont pas fait l'objet d'une déclaration d'exportation électronique, la TVA suisse (8,1 %) pourrait être réclamée rétroactivement sur ≈ 7 250 CHF de CA conservé hors CH (ordre de grandeur : ≈ 540–590 CHF de TVA). Montant faible, mais **à vérifier** ; ce n'est pas une conclusion de conformité. **Confiance** : faible (je n'ai pas accès aux déclarations ni aux étiquettes de transport).
  - **Donnée manquante** : transporteur, mode (DAP/DDP), preuve d'exportation, qui a payé droits et TVA d'importation côté client.
- **Fait [W]** : promesse publique « livraison gratuite en Suisse dès 50 CHF ; forfait 10 CHF Europe » ; page DE : « Kostenloser Versand für alle Bestellungen » ; frais effectivement facturés ≈ 31 CHF.
- **Interprétation** : les commandes étrangères existent sans offre structurée, avec un panier élevé. Rien n'indique si elles sont rentables (frais réels de port, droits, refus inconnus). **Confiance** : moyenne sur les volumes, faible sur la rentabilité.

---

## 2. Comparaison des cinq pays

Les cellules marquées « non sourcé » ne sont pas remplies : je n'invente aucun chiffre. Les colonnes « concurrence » reposent sur le benchmark bm_01 (seuls les acteurs documentés).

| Critère | DE | FR | AT | IT | NL |
|---|---|---|---|---|---|
| **Demande** (volumes de recherche mensuels, Ahrefs, 3 requêtes produit) [T] | « adidas samba » 164 000 ; « new balance 530 » 134 000 ; « air jordan 4 » 7 600 | 100 000 ; 110 000 ; 13 000 | « adidas samba » 18 000 ; autres < seuil du top-40 | 88 000 ; 126 000 ; 8 000 | 57 000 ; 54 000 ; 4 700 |
| Référence CH | « adidas samba » 28 000 ; autres sous le seuil du top-40 (≈ 600 à 8 200) | idem | idem | idem | idem |
| **Lecture** | DE ≈ 5,9 × la CH sur « adidas samba » | ≈ 3,6 × | ≈ 0,6 × | ≈ 3,1 × | ≈ 2,0 × |
| **Langue** | allemand (32,9 % de nos commandes y atterrissent déjà en /de **[I]**) | français (même langue que notre marque) | allemand | **aucune URL italienne** (`/it` = 404 **[W]**) | néerlandais : **aucune version** (anglais/allemand par défaut) |
| **Concurrence documentée** (bm_01) | non couverte par le panel (aucun acteur DE documenté) | Limited Resell (redressement judiciaire 07-2026), Wethenew (a racheté domaine/base/réseaux de Kikikickz) | non couverte | non couverte (Limited Resell y avait étendu) | SneakerHype (faillite 05-2025), Restocks |
| **Moyens de paiement** | EHI 2025 (part du CA e-commerce) : PayPal 28,7 %, facture 26,1 %, prélèvement 14,4 %, cartes 13,7 %, Klarna/Ratenkauf 4,7 % [S] | non sourcé ici (hypothèse : carte bancaire dominante) | non sourcé ici | non sourcé ici | iDEAL ≈ 71 % des achats en ligne (2025) [S], migration vers Wero d'ici fin 2027 [S] |
| **Droit de douane** (>150 EUR) | 16,9 % pays tiers [O] | idem | idem | idem | idem |
| **TVA standard** (TEDB / Your Europe, 2026) | 19 % | 20 % | 20 % | 22 % | 21 % |
| **Retours / après-vente** | rétractation UE 14 j (§6) | idem | idem | idem | idem |
| **Transport** | Suisse → UE : hypothèse de port réel 20/30/40 CHF [H] (aucun devis) | idem | idem | idem | idem |

Sources chiffrées :
- Volumes : Ahrefs MCP `keywords-explorer-volume-by-country`, 2026-11-02 ; données dans `tableaux/bm_eu_demande_ahrefs_2026-11-02.csv`. **Limites** : trois mots-clés de marque produit, volumes globaux de requêtes (pas de la demande de revente sur StockX-type) ; « < seuil » = absent du top-40 pays retourné par l'outil. Ne dit rien du pouvoir d'achat ni de la concurrence.
- Paiements DE : EHI, « Online-Payment 2026 », relayé par https://www.it-finanzmagazin.de/online-payment-rechnungskauf-und-paypal-weiter-dominierend-laut-ehi-studie-online-payment-2026-244098/ et https://www.ehi.org/presse/smartphone-statt-portemonnaie-mobile-payment-boomt/ : *« PayPal … 28,7 Prozent … Der Kauf auf Rechnung … 26,1 Prozent. »* ; CA e-commerce DE 2025 ≈ 87,7 Md EUR (panel de 172 commerçants, non représentatif de tous). Coûts moyens : PayPal ≈ 1,94 %, facture ≈ 1,42 % (max 5,99 %), prélèvement ≈ 0,65 %.
- Paiements NL : https://www.betaalvereniging.nl/en/knowledge-base/online-payments/ — *« iDEAL remains the most widely used payment method, accounting for 71% of all online purchases »* ; migration vers Wero « by the end of 2027 at the latest » ; lancement des paiements commerciaux Wero NL le 26 oct. 2026 (https://european-payments-initiative-lux.prezly.com/epi-company-initiates-wero-roll-out-in-the-netherlands).
- TVA : https://europa.eu/youreurope/business/finance-and-tax/vat/vat-rules-rates/index_en.htm (DE 19, FR 20, AT 20, IT 22, NL 21) ; base TEDB https://ec.europa.eu/taxation_customs/tedb/ (non contraignant).

**Faits / Interprétation / Reco / Confiance**
- **Fait** : DE a la demande la plus forte parmi les cinq (≈ 6 × la CH sur une requête) ET la couche DE du site est déjà la deuxième langue par les commandes (32,9 %). **Interprétation** : DE est le premier candidat de pilote, avec AT en extension naturelle (même langue, mêmes moyens de paiement probables **[H]**). **Reco** (mécanisme : réduire l'effort de localisation) : pilote DE+AT avec PayPal et facture/Klarna *si* la passerelle les propose (non vérifié). **Confiance** : moyenne-faible (volumes sur 3 mots-clés).
- **Fait** : FR = 15 des ≈ 31 commandes hors CH. **Interprétation** : la langue explique probablement l'avance de FR sans effort ; mais FR est aussi le marché où le concurrent le plus documenté (Wethenew) opère. **Confiance** : faible.
- **Fait** : IT et NL n'ont pas de version dédiée (404 / pas de langue). **Reco** : IT et NL après le pilote, avec traduction préalable et — pour NL — iDEAL/Wero obligatoire (71 % des achats en ligne). **Confiance** : moyenne.
- **Non sourcé** (à compléter) : parts de marché de chaque concurrent local ; prix livrés des concurrents UE sur 20 références identiques ; moyens de paiement FR/AT/IT ; coût réel du support multilingue.

---

## 3. Coût rendu chez le client (livré, TTC) — calcul reproductible

Script : `calculs/bm_eu_01_pilote.py` → `tableaux/bm_eu_landed_cost.csv`. Paramètres : prix HT CH 201,6 CHF (fin_00), port réel H = 20/30/40 CHF, EUR/CHF 0,93 [H], taux de TVA ci-dessus, droit 16,9 % sur la valeur en douane (prix + port, hypothèse CIF), régime IOSS ≤ 150 EUR = 3 EUR/article + TVA destination perçue au paiement.

| Pays | Panier moyen (201,6 HT) — port 30 | vs CH TTC | Petit ticket (100 HT) — port 30 | vs CH TTC |
|---|---|---|---|---|
| DE | 322 CHF (droit 39, TVA import 51) | +48 % | 152 CHF (droit 2,8, TVA 19) | +40 % |
| FR | 325 CHF | +49 % | 153 CHF | +41 % |
| AT | 325 CHF | +49 % | 153 CHF | +41 % |
| NL | 328 CHF | +50 % | 154 CHF | +42 % |
| IT | 330 CHF | +52 % | 155 CHF | +43 % |

Même le petit ticket reste à +40 % car le port (30 CHF) pèse lourd sur un article à 100 CHF.

**Faits sourcés** :
- Droit : TARIC 6404 11 00 « sports footwear; tennis shoes, basketball shoes, gym shoes, training shoes and the like », *« Third-country duty 16.9 % … Erga omnes »* (https://tarific.eu/en/tariff/6404110000 ; https://www.thetradehub.eu/en/customs/taric/640411000010 ; consultés 2026-11-02). **Réserve** : sites tiers dérivés de TARIC ; vérifier dans TARIC officiel (https://ec.europa.eu/taxation_customs/dds2/taric/measures.jsp) et par ruling BTI (gratuit, valable 3 ans selon tarific.eu) ; la classification dépend de chaque produit (cuir, textile, collectibles, vêtements, montres = autres codes).
- Préférence UE–Suisse : droit 0 % possible **seulement** avec origine UE/CH prouvée (EUR.1 / déclaration sur facture, même source tarific.eu). Les sneakers de marque fabriquées en Asie n'ont pas d'origine suisse → le droit s'applique. **[H]** : l'origine de chaque produit est un point à confirmer ligne par ligne.
- Seuil de 150 EUR : Règlement (UE) 2026/382, art. 2 : *« From 1 July 2026 until 1 July 2028, a customs duty of EUR 3 per item in a consignment the intrinsic value of which does not exceed a total of EUR 150 shall apply »* (https://eur-lex.europa.eu/eli/reg/2026/382/oj/eng). Guidance Commission (version 5 oct. 2026) : le droit de 3 EUR s'applique aux envois ≤ 150 EUR en vente à distance quel que soit le régime TVA (IOSS, régime spécial, TVA standard) et la déclaration H1/H6/H7 ; les marchandises à tarif préférentiel peuvent en être exclues sous conditions (https://taxation-customs.ec.europa.eu/news/guidance-and-legal-text-temporary-flat-fee-low-value-imports-which-will-apply-until-1-july-2028-2026-06-08_en). La Commission précise que la charge repose sur le déclarant (vendeur/importateur), pas le consommateur.
- **Union handling fee** : « fixed amount per item », montant à fixer par acte délégué, attendu à partir du 1er nov. 2026 (guidance 5 oct. 2026 : *« The Union handling fee is therefore expected to apply from 1 November 2026 »*). **Montant non trouvé** au 2026-11-02 → **non modélisé**. Un coût par article supplémentaire est donc à prévoir [H].
- IOSS : un assujetti **non établi dans l'UE** doit nommer un intermédiaire établi dans l'UE (https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en : *« A taxable person not established in the EU who wants to use the import scheme, needs to appoint an intermediary »*) ; la Norvège fait exception, pas la Suisse (https://www.revenue.ie/en/tax-professionals/tdm/value-added-tax/part10-special-schemes/vat-ecommerce-rules/import-one-stop-shop-ioss.pdf). Coût d'un intermédiaire : non sourcé.

**Effet de falaise** (déduit des règles ci-dessus, non d'une source unique) : un envoi à 149 EUR de valeur intrinsèque paie 3 EUR de droit par article ; à 151 EUR, droit de 16,9 % sur la valeur en douane (valeur + frais d'acheminement) ≈ 25–30 EUR. C'est une **marche** dans le prix rendu, pas une pente. Découper artificiellement un envoi pour passer sous le seuil serait une pratique visée comme abusive par la Commission (https://taxation-customs.ec.europa.eu/customs/eu-customs-reform_en : *« importers splitting imports or undervaluing their products »*) — **non recommandé**.

**Interprétation** : sur le panier moyen (≈ 217 EUR) on est du mauvais côté de la marche pour la plupart des commandes. Seuls ≈ 30 % des unités (≈ 13 % du CA) se situent en dessous de ≈ 150 EUR (`bm_options_base.csv`). **Hypothèse** : une offre Europe viable se focalise d'abord sur des articles < 150 EUR (accessoires, petites pièces, collectibles) ou accepte de vendre à des clients disposés à payer +48 %. À tester, pas à présumer.

**Confiance** : élevée sur le mécanisme (règles officielles), moyenne sur les ordres de grandeur (port, change, classification = hypothèses).

---

## 4. P&L simplifié du pilote (par commande, avant publicité)

Script : `calculs/bm_eu_01_pilote.py` → `tableaux/bm_eu_pilote_pnl.csv` ; `calculs/bm_eu_02_refus.py` → `tableaux/bm_eu_refus_sensibilite.csv`.

Base fin_00 (commande moyenne 2026, CHF) **[I]** : revenu net HT 201,6 ; coût d'achat 150,8 ; frais de paiement 6,1 ; préparation + expédition CH 14,0 [H] ; litiges 1,8 → contribution avant pub **28,9**.

| Schéma (DE, port facturé 31,0 ; panier moyen) | Port réel H 20 | Port réel H 30 | Port réel H 40 |
|---|---|---|---|
| **DAP** : client paie droit + TVA à la livraison | 39,9 | **29,9** | 19,9 |
| **DDP, droit absorbé**, TVA payée par le client | 2,4 | **−9,2** | −20,9 |

Sensibilité au **refus de colis en DAP** (achat déjà fait, port aller + retour 30 CHF chacun [H], 90/70/50 % du coût d'achat récupérable [H]) :

| Taux de refus | Contribution (récup. 90 %) | (70 %) | (50 %) |
|---|---|---|---|
| 0 % | 29,9 | 29,9 | 29,9 |
| 5 % | 24,7 | 23,1 | 21,6 |
| 10 % | 19,4 | 16,4 | 13,4 |
| 20 % | 8,9 | 2,9 | −3,2 |

**Fait [I]** : la publicité actuelle coûte 35,0 CHF/commande ; après acquisition la contribution suisse est −6,2 CHF (fin_00). **Interprétation** : même sans refus, une contribution de ≈ 30 CHF est très en dessous du coût d'acquisition suisse ; **le pilote ne peut pas être financé par de la publicité payante** et doit s'appuyer sur la demande organique (SEO DE, mails, bouche-à-oreille). **Confiance** : moyenne (structure) / faible (valeurs H).

**À ne pas oublier (non chiffré)** : coût des retours transfrontaliers, remboursement (§6), support dans la langue, taux de change CHF/EUR/USD, temps de travail (au moins 1 h/semaine de suivi du pilote **[H]**), frais d'un éventuel intermédiaire IOSS, frais d'exportation (e-dec) par envoi.

### Pilote proposé (hypothèse, à valider par l'entrepreneur et un fiscaliste)

- **Périmètre** : DE + AT (+ FR à titre d'observation), langue DE/FR existante, 90 jours maximum, **plafond 60 commandes** ; régime DAP clairement annoncé avant paiement (droits + TVA à la livraison) ; port facturé = coût réel ; pas de publicité payante ; pas de TVA/droit absorbé.
- **Budget** : hors marchandises (déjà achetées à la commande) : intermédiaire IOSS éventuel + conseil fiscal/douane (devis non obtenus) + temps de travail. **Aucun montant inventé** : à chiffrer avec devis.
- **Critères de succès (à fixer avant de commencer)** : contribution moyenne avant pub ≥ **20 CHF/commande** après refus et retours ; refus < 5 % ; délai de livraison médian aligné sur la promesse publique ; ≥ 1 transporteur confirmé avec tarif réel ≤ 30 CHF ; aucun litige TVA/douane.
- **Critères d'abandon** : refus ≥ 10 % ; port réel > 40 CHF ; contribution < 10 CHF/commande ; incident douanier non résolu ; plaintes de livraison > 5 % des commandes.
- **Mesures** : conversion visiteurs DE/AT → commande ; part d'abandons au paiement après affichage du total rendu ; délai ; remboursements.

---

## 5. Expédier depuis la Suisse ou stock / partenaire UE

| Option | Mécanisme | Avantage | Inconvénient | Preuve |
|---|---|---|---|---|
| **A. Expédition CH → UE** (statu quo élargi) | Export suisse + import UE à chaque colis | Aucune structure, test sans capital | Droit 16,9 % > 150 EUR ; port élevé ; refus de colis | §3–4 |
| **B. Intermédiaire IOSS (≤ 150 EUR)** | TVA perçue au paiement, 3 EUR/article de droit | Prix rendu connu à l'avance, moins de refus | Seulement ≤ 150 EUR ; intermédiaire UE obligatoire ; coût non sourcé | [O] |
| **C. Stock chez un partenaire/3PL UE** | Marchandise importée en gros puis vendue localement | Livraison locale rapide, retours locaux | Droits à l'import en gros (16,9 % sur la valeur d'achat) ; immobilisation de stock ; immatriculation TVA dans le pays probable **[H]** ; contradictoire avec le modèle « achat après commande » | [H] à valider |
| **D. Achat auprès d'un fournisseur déjà dans l'UE** | La marchandise ne passe pas par la Suisse | Pas de double transit | Dépend de la source (StockX Express) : *d'où partent les colis ?* — donnée manquante | question ouverte |

**Question clé non résolue** : d'où arrivent les paires achetées via StockX Express (entrepôt UE, Suisse ?). Si la marchandise transite déjà par l'UE avant la Suisse, un envoi direct vers le client UE aurait un sens économique tout autre. **À demander à l'entrepreneur** (logs de commandes d'achat, étiquettes).

Aucun droit au financement, aucune subvention ni aide à l'export n'a été recherchée ici ; je n'en affirme aucune. Structure locale (entité UE, représentant fiscal) : non étudiée au-delà de l'intermédiaire IOSS ; à confier à un fiscaliste. Devises : site Markets déjà configuré en EUR pour « Europe » et « France » [I] ; risque de change non chiffré.

---

## 6. Retours, rétractation et après-vente

- **Suisse** : pas de droit de rétractation légal pour les achats en ligne : *« Das Schweizer Recht sieht kein allgemeines Widerrufsrecht bei Internetkäufen vor »* (SECO, https://www.seco.admin.ch/de/probleme-nach-dem-kauf ; kmu.admin.ch https://www.kmu.admin.ch/de/widerrufsrecht-in-der-schweiz-und-der-eu). Notre politique (14 jours, échange/avoir, frais de 10 %) est donc **volontaire** — cx_03.
- **UE** : *« the consumer shall have a period of 14 days to withdraw from a distance … contract, without giving any reason »* ; le professionnel rembourse tous les paiements, y compris les frais de livraison standard, au plus tard 14 jours après (Directive 2011/83/UE art. 9 et 13, https://eur-lex.europa.eu/eli/dir/2011/83/oj/eng ; synthèse https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm). Le consommateur supporte les frais de retour **si** le vendeur l'a clairement informé avant l'achat.
- **Interprétation** : si l'UE s'applique à une offre ciblant des consommateurs de l'UE (point de droit **non tranché ici**, à faire valider par un juriste), la politique actuelle (avoir uniquement, 10 % de frais, CH seulement dans le schéma `MerchantReturnPolicy`) serait inadaptée. Le coût d'un retour UE → CH n'est pas modélisé (douane de retour, transport, éventuelle perte de valeur). **Confiance** : moyenne sur la règle, faible sur l'applicabilité au cas.
- **Reco** (mécanisme : réduire le risque réglementaire et la perte sur retours) : dans le pilote, publier une politique UE distincte, vérifiée par un conseil, avant le premier envoi ; ne pas réutiliser la politique CH.

---

## 7. Ce qui doit d'abord être prouvé en Suisse

1. **Contribution positive après acquisition** : aujourd'hui −6,2 CHF/commande (fin_00) ; résultat avant rémunération ≈ −21,2 k CHF. Une extension qui coûte du temps et du capital avant cette preuve est le motif d'échec le plus documenté (bm_01, E-lessons).
2. **Délai de livraison tenu** : médiane 9–14 jours d'expédition (fin_00) vs promesse « 48 h » / « 5–10 jours » ; à l'étranger l'écart se creuse.
3. **Promesses et politiques cohérentes** (port, retours, avis : cf. bm_03 A1, A6 ; bm_04) avant d'exposer des clients UE.
4. **Capacité de support multilingue** : cx_02 (e-mails/SAV) ; le DE apporte déjà un tiers des commandes.
5. **Traitement TVA/douane maîtrisé** (preuves d'export des ≈ 27–31 commandes déjà expédiées).

---

## 8. Recommandation

| Élément | Contenu |
|---|---|
| **Fait observé** | Panier moyen > 150 EUR → droit 16,9 % (CH→UE) ; prix rendu ≈ +48 % ; contribution CH après acquisition < 0 ; ≈ 31 commandes hors CH ou « NA » en 12 mois, panier élevé, sans offre structurée ; DE a la plus grande demande de recherche parmi les cinq (≈ 6 × la CH sur une requête) |
| **Interprétation** | L'Europe n'améliore pas aujourd'hui la rentabilité unitaire ; elle augmente le risque (douane, retours, refus) sur un modèle sans stock |
| **Hypothèse** | Une niche < 150 EUR ou une clientèle DACH prête à payer la prime existe ; à tester à coût plafonné |
| **Recommandation** (mécanisme : apprendre à coût borné, sans ajouter d'acquisition payante) | Pas de lancement d'un marché UE avant la preuve CH (§7). Ensuite pilote DE+AT en DAP, 90 jours, 60 commandes, critères d'arrêt écrits. Ne pas créer de stock/structure UE avant résultats |
| **Confiance** | Moyenne sur le mécanisme économique ; faible sur la demande réelle (aucune donnée GSC/GA4) |

---

## 9. Limites et données manquantes

- **Aucun devis transporteur** : le port réel (20/30/40 CHF) est une hypothèse de sensibilité ; transporteur, DAP/DDP, incoterms utilisés pour les ≈ 27–31 commandes déjà expédiées : inconnus.
- **Droit et classification** : 16,9 % lu sur des sites tiers (tarific.eu, thetradehub.eu) qui reprennent TARIC ; aucune vérification BTI ni classification produit par produit ; collectibles, vêtements, montres (LEGO, Swatch, Fear of God) ont d'autres codes et taux (non traités) ; origine de chaque produit non vérifiée.
- **Union handling fee** : montant non trouvé au 2026-11-02 ; non modélisé.
- **TVA** : taux standard uniquement (TEDB, non contraignant) ; TVA réduite non applicable aux chaussures, **non vérifié** ; pas de régime spécial (OSS, stock UE) analysé.
- **Preuve d'exportation (e-dec)** des commandes étrangères : non vérifiable ; ≈ 540–590 CHF de TVA suisse potentielle (ordre de grandeur) non confirmée.
- **Concurrence par pays** : seul le panel bm_01 ; aucun relevé de prix livrés UE (non fait : le site public est bloqué aux clients scriptés et aucun concurrent n'a été contacté) ; aucune part de marché sourcée.
- **Demande** : trois mots-clés, volumes mondiaux de requêtes, plan Ahrefs Lite ; ni GSC ni GA4 ; aucune donnée de pouvoir d'achat ou de taille du marché de la revente par pays.
- **Paiements** : DE et NL sourcés ; FR/AT/IT non sourcés ; passerelle de la boutique (moyens de paiement actifs) non vérifiée.
- **Financement, aides, structure locale** : non recherchés ; aucun droit n'est affirmé.
- **Avis juridique** : applicabilité du droit de rétractation UE à une boutique suisse ciblant l'UE non tranchée ici.
- **À fournir** : transporteur et devis (CH→DE/AT/FR) ; preuve d'exportation des ≈ 27–31 commandes ; origine géographique des colis StockX Express ; avis d'un fiscaliste/transitaire ; décision sur la tolérance de l'entrepreneur au risque (budget maximum du pilote).
