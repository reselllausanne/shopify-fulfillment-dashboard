# ads_09 : enchère marginale et enchère sur la marge

Date : 2026-11-11. Lecture seule. Scripts : `calculs/ads_09_marge_par_marque.py`, `calculs/ads_09_elasticite.py`. Données : `tableaux/ads_09_*.csv`.
Légende : **F** fait mesuré, **D** déclaré, **I** interprétation, **H** hypothèse, **R** recommandation.

## 0. Correction de ce que j'ai dit plus tôt

J'avais écrit « ROAS Google d'équilibre ≈ 3,5-3,9 ». Cela suppose que **toutes** les commandes Shopify (y compris direct, organique) sont causées par la pub. C'est la borne la plus généreuse.
Sur la base corrigée (TDFN 2,1 %, `fin_05_orders_pnl.csv`, août-octobre) :

| Définition | Valeur |
|---|---|
| Valeur Google par conversion revendiquée | 214,6 CHF (166,8 k / 777 conv.) |
| Contribution avant pub par commande | 45,6 CHF (1 123 commandes, médiane 40,4) |
| ROAS Google d'équilibre si chaque conversion revendiquée est incrémentale | **4,7** (F, calcul) |
| ROAS d'équilibre sur valeur brute Shopify / contribution | **5,1** |
| Idem si la pub est créditée de toutes les commandes en plus de celles que Google revendique | 3,3 |

**F** : août-octobre, la pub coûte 42,0 k pour une contribution de 51,2 k sur *toutes* les commandes. Avec les seules commandes revendiquées par Google (777 × 45,6 = 35,4 k), la pub est à −6,6 k.
**I** : un tROAS de 3,6-4,5 est sous l'équilibre dans tous les cas sauf « la pub cause tout ». Même conclusion que `ads_04_propositions.md` (« tROAS 3,9 contradictoire avec la rentabilité »).

## 1. Théorie de l'enchère marginale (sources vérifiées)

- **F (doc Google, Target ROAS)** : Smart Bidding règle les CPC max « pour maximiser la valeur de conversion tout en visant un ROAS **moyen** égal à la cible ». Certaines conversions rapportent plus, d'autres moins. [support.google.com/google-ads/answer/6268637](https://support.google.com/google-ads/answer/6268637)
- **I (conséquence, Adsrunner et Riemeyer, non académique)** : une cible moyenne n'est pas une ligne d'arrêt. Les dernières enchères gagnées rapportent moins que la cible. Régler le tROAS à l'équilibre fait perdre sur la marge par construction. Règle : monter la dépense tant que **ROAS marginal ≥ 1 / marge de contribution**.
- **F (Meridian, Google)** : mROI = résultat incrémental du dollar suivant ; si mROI ≪ ROI, le canal sature. Hill function pour la saturation. Les extrapolations hors de la plage observée sont à lire avec prudence (doc Google).
- **F (Lewis & Wong, arXiv 2208.12809)** : la valeur d'une impression est son **effet incrémental** (β · poids), pas la conversion prédite. En enchère au second prix on enchérit sa valeur ; au premier prix on applique un « bid shading ». L'estimation causale exige de **randomiser les enchères** (instruments, « ghost bids »). Test de Hausman pour savoir si le modèle prédictif suffit à la place du causal. Impossible dans Google Ads (PMax est une boîte noire) : on ne peut qu'**approcher** par expériences géographiques ou Conversion Lift.
- **F (Google, Conversion Lift)** : par utilisateurs, minimum 1 000 conversions observées et 5 000 USD de budget. Par géographie : PMax supporté, tests « holdback » et « go-dark ».
- **I (Sellforte, Riemeyer)** : tROAS à régler = iROAS voulu ÷ facteur d'incrémentalité, avec facteur = iROAS ÷ ROAS plateforme. Exemple : iROAS 3 pour ROAS plateforme 5 → facteur 0,6 → pour iROAS 5, tROAS = 8,3.

## 2. Mes données : ROAS marginal

### 2.1 Élasticité de la valeur Google à la dépense (F, jours `ads_campaign_daily`)

Régression log-log, n = 313 jours en 2026, effet mois :

| Modèle | Élasticité | ROAS moyen | ROAS marginal ≈ élasticité × moyen |
|---|---|---|---|
| jours 2025-07→2026-11, sans contrôle | 0,52 ± 0,13 | 4,41 | 2,28 |
| jours, effet mois | 0,67 ± 0,28 | 4,41 | 2,96 |
| jours 2026, effet mois | 0,65 ± 0,29 | 4,32 | 2,83 |
| jours 2026, mois + jour de semaine | 0,62 ± 0,30 | 4,32 | 2,70 |
| semaines complètes 2026 | 0,68 ± 0,32 | 4,33 | 2,93 |

Quintiles de dépense journalière 2026 : 183 CHF/j → ROAS moyen 5,74 ; 252 → 4,58 ; 302 → 5,00 ; 371 → 4,07 ; 549 → 3,53.
**I** : l'euro marginal rapporte ≈ 2,3-3,0 de valeur Google, contre un équilibre de 4,7-5,1. Contribution marginale ≈ 2,7 × 16-18 % ≈ **0,45-0,5 CHF par CHF dépensé**.
**F, cohérent** : `ads_04_marginal_regimes.csv`, régime A→C, +12,3 k de pub pour +223 commandes Shopify (toutes), soit 55 CHF par commande supplémentaire contre 45,6 de contribution. ROAS marginal Google 2,8.
**Limite** : observationnel. La demande fait monter dépense et valeur ensemble, donc l'élasticité est plutôt une borne haute. Le choix journalier de dépense est piloté par Google, pas par toi.
**Non utilisable** : la dépense « optimale » extrapolée (≈ 50-75 CHF/j). Elle est loin de la plage observée (min ≈ 180 CHF/j) et le modèle en puissance force le ROAS vers l'infini quand la dépense tend vers 0. Je ne la retiens pas.

### 2.2 Budget doublé le 10 novembre (F)

- Dépense 8-10 novembre : 296, 284, 320 CHF/j. Aucune hausse (budgets non limitants : 0 % d'impression perdue au budget). **Le doublement des budgets n'a rien changé à la dépense.**
- ROAS Google 3 jours : 0,82, contre 3,12 sur 12 jours précédents (27 oct→7 nov). Conversions 1,2/j contre 4,4/j.
- **F** : sur 314 jours de 2026, le ROAS glissant 3 jours n'est jamais descendu en dessous de 0,82 avant maintenant. Seulement 0,6 % des fenêtres sont ≤ 1,0. **Ce n'est pas du bruit ordinaire.**
- **F** : commandes Shopify 8-10 novembre : 7, 4, 5 (5,3/j) contre 7,8/j sur les 12 jours précédents ; ventes 1 222 CHF/j contre 1 932 CHF/j. Baisse plus faible que celle des conversions Google (−73 %).
- **I** : la baisse côté Google est plus forte que côté Shopify. Cela pointe vers une perte d'attribution/tracking partielle plus une baisse de demande, pas vers un seul des deux. Je ne peux pas trancher sans les données de conversion par action et les tags (R : voir §5).

## 3. Marge par marque et POAS (F, août-octobre, base corrigée)

Marque d'une commande = marque de la ligne la plus chère (mots-clés du titre). POAS ≈ ROAS Google × contribution / valeur brute de la marque. Il suppose que la valeur Google est incrémentale et brute : **c'est une borne haute**.

| Marque | Dépense | ROAS Google | Contribution / brut | Contribution / cmd | ROAS d'équilibre | POAS ≈ |
|---|---|---|---|---|---|---|
| Nike | 14 040 | 4,22 | 18,1 % | 44,2 | 5,5 | 0,76 |
| Adidas | 9 299 | 3,70 | 16,0 % | 36,7 | 6,3 | 0,59 |
| Jordan | 2 887 | 4,13 | 20,0 % | 64,5 | 5,0 | 0,83 |
| New Balance | 1 792 | 3,94 | 16,7 % | 42,6 | 6,0 | 0,66 |
| On | 1 618 | 3,13 | 16,1 % | 42,8 | 6,2 | 0,50 |
| Fear of God | 1 578 | 3,37 | 30,8 % | 28,9 | 3,2 | **1,04** |
| Asics | 1 555 | 2,65 | 22,1 % | 51,4 | 4,5 | 0,59 |
| Autres | 1 246 | 3,49 | 22,9 % | 75,1 | 4,4 | 0,80 |
| UGG | 896 | **1,01** | 31,6 % | 63,3 | 3,2 | **0,32** |
| Saucony | 575 | 3,32 | 21,7 % | 53,8 | 4,6 | 0,72 |
| Supreme | 279 | 5,06 | 21,8 % | 30,8 | 4,6 | **1,10** |

Fichiers : `tableaux/ads_09_marge_par_marque.csv`, `ads_09_poas_par_marque.csv`. Échantillons faibles pour On, Saucony, UGG (14-15 commandes).
- **F** : seules 2 marques à POAS > 1 (Fear of God, Supreme), toutes deux petites. Toutes les marques à fort volume sont à 0,5-0,8.
- **F** : ROAS et POAS classent différemment : Fear of God a un ROAS de 3,37 (sous Nike, Jordan, New Balance, Adidas) mais un POAS de 1,04, le plus haut parmi les marques à volume ; Adidas et Asics ont le même POAS (0,59) avec des ROAS de 3,70 et 2,65.
- **F** : le ROAS d'équilibre varie de 3,2 à 6,3 selon la marque (facteur 2). Un tROAS unique ne peut pas être juste pour toutes.
- **F** : 15 % des commandes ont une contribution négative (médiane 40,4 ; 10ᵉ percentile −12 ; 90ᵉ 104).
- **I** : contrairement aux cas de la littérature (marges 12-58 %), ton spread de marge est étroit (16-32 %) ; un découpage par marge fera moins bouger la répartition. Le plus gros écart est plutôt **prix du panier** (contribution 20 % sous 150 CHF, 11 % au-dessus ; `ads_04_contrib_par_prix.csv`, ancienne base) et **marque/catégorie**.

## 4. Enchérir sur la marge : mécanismes (sources)

- **F (Google Ads Help)** : `cost_of_goods_sold` dans Merchant Center + conversions avec données de panier (IDs d'articles identiques à l'attribut `id` du flux) donnent rapports de marge brute. COGS « n'a pas besoin d'être exact » (estimation ex. 80 % du prix). Source : [support.google.com/google-ads/answer/14943482](https://support.google.com/google-ads/answer/14943482), [.../9028254](https://support.google.com/google-ads/answer/9028254).
- **F** : l'enchère sur la marge brute (« gross profit optimization », cible profit tROAS) est une **bêta limitée à certains comptes**, PMax et Shopping standard. Google annonce +15 % de profit (donnée interne, 2023). Aucune doc d'activation trouvée (Eggknite, 7 oct. 2026). Non planifiable sans contact Google.
- **F** : il n'existe pas de stratégie « maximiser le profit » ; le profit entre par la **valeur de conversion** que tu envoies (Google Ads Help, tableau des objectifs : « augmenter le profit » = tROAS ou Maximiser la valeur).
- **F (doc API)** : les **règles de valeur de conversion** ne portent que sur audience, lieu, appareil, itinéraire. Pas par produit ni marge. Opérations : ADD, MULTIPLY (0,5-10), SET.
- **I (praticiens, cas non indépendants)** : deux voies. (a) Valeur de conversion = profit par commande (envoi serveur, voir `ads_04_propositions.md` P4 « conversion secondaire contribution »). (b) Étiquettes de marge dans le flux + campagnes ou groupes de produits par palier, avec tROAS dérivé du seuil de chaque palier.
- **F (Google Ads Help, ajustements)** : un retrait ou une réévaluation n'est lu par l'enchère que **dans les 7 jours** après l'enregistrement ; les rapports acceptent jusqu'à 54 jours. Les remboursements Shopify (jusqu'à 120 jours) échappent donc partiellement à l'enchère.
- **F (Shopify)** : le profit n'est rapporté que pour les variantes dont le coût était enregistré à la vente.
- **Cas** (vendeurs d'outils ou d'agences, pas d'audit indépendant) : Magnify (+62 % de profit brut, ROAS 4,5 → 4,1, 90 jours) ; Ad-Lab (POAS 1,0 → 1,4 en 60 jours, CA et dépense stables) ; Wheelhouse (ROAS +59 % sur un an). **Aucun** n'est randomisé ; tous gèrent des marges 12-58 %.

## 5. Ce que ça implique pour toi

**R, sans toucher à la prod avant le Black Friday (27 nov), sauf décision de ta part :**
1. **Mesurer l'incrémentalité d'abord** (le facteur qui convertit ROAS Google en ROAS réel). Test géographique ou arrêt/relance contrôlée sur une période courte. Seuil Conversion Lift utilisateurs (1 000 conversions, 5 000 USD) non atteint par campagne ; géo possible mais puissance faible à 6 conv./j.
2. **Conversion secondaire « contribution »** (déjà P4) : à construire côté serveur, comparée 8 semaines à la valeur brute. Aucun effet mesuré aujourd'hui.
3. **Remboursements/annulations** : ajustements de conversion dans les 7 jours (valeur rendue ≈ 7 % selon `ads_04_propositions.md`).
4. **UGG** : 896 CHF pour 4 conversions, ROAS 1,0, POAS 0,3 ; décision à ta main (déjà documenté dans le mémo).
5. **Ne pas lire le ROAS 3 jours du 8-10 novembre comme effet des changements du 10** : le budget doublé n'a pas augmenté la dépense, et la baisse a commencé le 8. Vérifier d'abord le suivi (actions de conversion, tag, délais de conversion).

## 6. Limites

- Contribution sur base corrigée (TDFN 2,1 % non prouvé ; 13 % de coûts d'achat estimés ; Octobre 23 % estimé).
- Marque d'une commande = ligne la plus chère (mots-clés) : classification imparfaite, catégorie « autres » grande (134 commandes).
- POAS par marque : valeur Google supposée incrémentale ; en réalité plus bas.
- L'élasticité est observationnelle et non causale.
- Aucune des sources « cas » n'est indépendante ni randomisée.

## Annexe : requêtes SQL (lecture seule)

```sql
-- tableaux/ads_09_ads_par_marque_aout_oct.csv
select coalesce(nullif(lower(custom_attr1),''),'(vide)') brand_label, round(sum(cost_micros)/1e6) cost, round(sum(conversion_value)) val,
       round(sum(conversions),1) conv, sum(clicks) clicks
from ads_product_daily where date between '2026-08-01' and '2026-10-31' group by 1 order by 2 desc;
-- tableaux/ads_09_jour_campagnes_total.csv
select date::text d, round(sum(cost_micros)/1e6,2) cost, round(sum(conversion_value)::numeric,2) val, round(sum(conversions)::numeric,2) conv,
       sum(clicks) clicks, sum(impressions) imp from ads_campaign_daily where date >= '2025-01-01' group by date order by date;
-- commandes Shopify par jour
select ("createdAt" at time zone 'Europe/Zurich')::date d, count(*) orders, round(sum("totalSalesChf")) sales from "ShopifyOrder" where "createdAt" >= '2026-10-20' group by 1 order by 1;
```
