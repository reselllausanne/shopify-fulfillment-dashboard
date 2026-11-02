# BM-01 — Benchmark d'entreprises comparables (BRIEF §12)

Sous-agent n°3. Lecture seule. Date de consultation de toutes les sources : **2026-11-02** (sauf mention). Pas de contact avec des tiers. Les montants sont dans la monnaie d'origine ; aucune conversion sauf mention.
Convention : **Fait** (source, date, périmètre) · **Interprétation** · **Hypothèse** · **Reco** (mécanisme économique) · **Confiance**. Type de preuve noté : **[A]** document officiel/comptes/rapport de curateur · **[E]** déclaration d'entrepreneur ou communiqué de l'entreprise · **[P]** affirmation d'un prestataire/tiers commercial · **[X]** estimation algorithmique tierce.

## 0. Verdict

1. **Aucun cas solide, audité et profitable d'un revendeur « achat après commande client » à grande échelle n'a été trouvé.** Le plus proche voisin de notre modèle (SneakerHype BV, NL) est en faillite depuis le 20 mai 2025 [A]. Les survivants documentés ont soit changé de modèle (Newcop vers la distribution officielle [E], Sneakersnstuff repris et redimensionné [E]), soit une rentabilité en dégradation visible (The Sneaker Store [A]), soit des chiffres non vérifiables (SneakerAsk [P][X], WOOVIN [E]).
2. **Panel retenu : 10 cas** (pas d'extrapolation : 5 cas sont des contre-exemples avec traces officielles, 3 sont des survivants à chiffres non audités, 2 sont des acteurs mondiaux sans comptes publics). Je n'en ai pas ajouté pour « remplir » : Sneak City n'a pas pu être identifié ; Vaditim est une faillite suisse réelle mais son lien avec la revente de sneakers n'est pas prouvé par les sources consultées (voir §3).
3. **Biais du survivant** : les échecs laissent des rapports de curateurs (publics), les réussites s'autodécrivent. Une absence de cas de succès audité ne prouve pas qu'il n'y en a pas ; elle impose de ne pas bâtir le plan sur une trajectoire de réussite non vérifiée.
4. **Trois causes d'échec reviennent dans les sources officielles** : (a) stock/retours non couverts par le fournisseur + baisse des prix quand les marques augmentent les tirages ; (b) croissance rapide financée par la trésorerie client/vendeur ; (c) **TVA/douane mal traitées à l'international** (Restocks, Sneaker District). Ces trois points sont directement testables sur notre dossier (voir `analyses/fin_00_base_financiere.md`, `bm_05_europe.md`).

---

## 1. Typologie

| Type | Définition | Cas du panel |
|---|---|---|
| A. Achat sur demande (« buy on request ») | Le site vend un catalogue virtuel ; achat après commande chez un tiers | **SneakerHype**, **Resell Lausanne (nous)**, SYSTRAM Resell, partiellement Limited Resell, SneakerAsk (stock + vendeurs) |
| B. Place de marché / consignation | Vendeurs tiers, commission, authentification | **Restocks/Kikikickz**, **WOOVIN**, GOAT Group (GOAT, Flight Club, Alias) |
| C. Détaillant à stock / distribution officielle | Stock acheté chez les marques, boutiques et/ou e-shop | **Sneakersnstuff**, **Newcop**, The Sneaker Store (revendeur en ligne multi-marques), Footshop |
| D. Hybride | Plusieurs modèles sur un même site | Limited Resell (revente + B2B + collectibles), Newcop en transition |

---

## 2. Fiches (10 cas)

### 2.1 SneakerHype B.V. (Pays-Bas) — type A, **faillite** — proximité : très élevée
- **Fait [A]** : faillite prononcée le **20-05-2025** (tribunal de La Haye, F.09/25/180). Rapport final du curateur (26-02-2026) : activité « achat et vente de sneakers » ; chiffres « Jaar 2025 : omzet € 550.052, résultat € −52.327,51, balance € 192.620 » ; **« B.V. créée en septembre 2024, auparavant VOF, pas de comptes »** (période exacte non précisée). Cause (rapport, ch. 1.5) : *« Zij kochten in op aanvraag »* (achat sur demande) ; les sneakers vendues pouvaient être retournées par le client mais **le retour n'avait pas été négocié à l'achat**, d'où un stock ; les marques ont augmenté les tirages, **ce qui a fait baisser les prix** ; le marché a basculé vers des sneakers « ordinaires », il fallait du volume qu'ils n'ont pas atteint. Stock vendu 15 000 € (rapport). Effectif réduit de 10 à 2 en un an (RTL). Boutique/showroom ouverts en 2023 (RTL, Omroep West). Le curateur cite des contacts avec **Klarna, Mollie, Shopify** (rapport).
  Sources : [faillissementsdossier.nl](https://www.faillissementsdossier.nl/faillissement/1869773/sneakerhype-b-v), [rapport n°4 bedrijven.com](https://bedrijven.com/faillissementen/documenten/111733), [RTL 22.05.2025](https://www.rtl.nl/nieuws/economie/artikel/5510113/exclusieve-sneakers-kopen-webwinkel-sneakerhype-failliet), [Omroep West](https://www.omroepwest.nl/economie/4969148/deze-week-failliet-ooit-bekende-sneakershop-moet-dicht).
- **Interprétation** : le modèle « achat à la commande » a fonctionné tant que l'écart de prix entre marché secondaire et détail était élevé ; l'élargissement (showroom, logiciel, effectif) a été fait quand cet écart se comprimait. Les retours non adossés à un fournisseur créent un stock mort.
- **Transférable** : la vigilance sur les retours (notre boucle échange/avoir : voir fin_00 §5) et sur l'écart de prix. **Non transférable** : ils avaient une boutique physique ; nous n'avons pas de preuve de leur structure de coûts.
- **Confiance** : élevée sur les faits (document officiel) ; moyenne sur la causalité (le curateur dit que la cause fait partie d'une enquête ultérieure).

### 2.2 Limited Resell / Kelman Group SASU (Nice, France) — types A+D, **redressement judiciaire** — proximité : très élevée
- **Fait [A]** : jugement d'ouverture de **redressement judiciaire le 16-07-2026** (tribunal de commerce de Nice), SIREN 884 513 961 (registre BODACC relayé par [crowd-atlas.com](https://crowd-atlas.com/fr/societes/limited-resell/), données du 23.10.2026, et [entreprises-a-vendre.com](https://entreprises-a-vendre.com/opportunite/e-commerce-de-sneakers-vetements-et-matcha-a-nice-nice-4e15ec)). Appel d'offres de reprise de l'administrateur judiciaire : **date limite 11-09-2026** ; « **CA 2025 (21 mois) : 2 487 847 € — CA 2024 (12 mois) : 2 407 950 €** », 6 salariés dont 3 alternants en fin de contrat, local de 48 m² ([ASPAJ](https://www.aspaj.fr/annonce/entreprise-specialisee-dans-la-vente-dans-le-e-commerce-de-sneakers-vetements-matcha-japonnais/)). « Aucune décision postérieure n'a été publiée au registre officiel » (entreprises-a-vendre, consulté 2026-11-02). La fiche entreprises-a-vendre affiche aussi « CA 2024 : 0 €, résultat net −266 k€ » *tels que déposés* : **donnée incohérente avec le CA 2024 de l'administrateur**, non retenue.
- **Fait [E]** : levée de **430 785 €** en financement participatif (Sowefund, ouverture 26.10.2023, objectif 400 k€) ; selon Tribuca (05.09.2025), tour de table de **900 000 €** fin 2024 avec « investisseurs privés, Bpifrance et partenaires bancaires » ; acquisition début 2024 de SneakersFromFrance ; expansion IT/ES/RO ; B2B avec Decathlon, Place des Tendances, Spartoo ; collectibles (Sonny Angel) depuis début 2025 ([Tribuca](https://tribuca.net/entreprises_151027973-limited-resell-accelere-son-developpement/)).
- **Interprétation** : même assortiment que nous (sneakers + streetwear + collectibles), même idée d'extension européenne et de B2B. 2,4 M€/an de CA pour 6–10 personnes n'a pas suffi malgré ≈ 0,9–1,3 M€ de capitaux levés. La cause précise de la procédure **n'est pas publiée** dans les sources consultées.
- **Hypothèse** : financement externe + croissance multi-pays + diversification avant d'avoir une marge unitaire prouvée = risque. À tester sur nos chiffres (contribution avant pub 28,8 CHF/commande, fin_00).
- **Confiance** : élevée sur l'ouverture de la procédure et sur les CA cités par l'administrateur ; faible sur l'origine des pertes.
- **Reco** : ne pas dupliquer son parcours (levée → expansion → B2B) avant d'avoir prouvé une contribution positive après publicité en Suisse.

### 2.3 The Sneaker Store ApS (Danemark) — type C (revendeur en ligne) — proximité : moyenne
- **Fait [A]** (registre danois via [bizdex.dk](https://bizdex.dk/companies/the-sneaker-store-aps-42250430), [regnskabsbasen.dk](https://regnskabsbasen.dk/selskab/the-sneaker-store-aps-42250430), [cvrdata.ai](https://cvrdata.ai/virksomhed/the-sneaker-store-aps-42250430) ; consultés 2026-11-02) — DKK, **bruttoresultat** (le chiffre d'affaires n'est pas publié) :

| Exercice | Résultat brut | Résultat net | Fonds propres | Employés (moy.) |
|---|---|---|---|---|
| 2021 | 622 678 | 389 926 | 429 926 | 2 |
| 2022 | 1 143 021 | −120 887 | 309 039 | 3 |
| 2023 | 4 187 770 | 1 188 208 | 1 977 247 | 6 |
| 2024 | 3 082 193 | 623 727 | 2 570 974 | 9 |
| **2025 (1.10.2024–30.9.2025)** | **−94 251** | **−3 146 577** | **−815 603** | 9 |

  Statut du registre : « aktiv », 3 employés (bizdex) ; forme ApS, capital 60 000 DKK. L'exercice 2024 est « 413 jours » selon mes notes précédentes ; non revérifié.
- **Fait [E]** (Nordjyske, date de l'article non retrouvée) : fondée en 2021 ; stratégie de contenu organique TikTok par du contenu personnel ; un content creator employé ; ouverture d'un e-shop en Suède (« novembre dernier ») et ambition d'autres pays ; en 2023 « bruttoresultat 4,2 M DKK, 1,2 M DKK de bénéfice, 14 employés ».
- **Fait [A?]** RetailNews titre « Nu lukker de forretning “med højt humør” » (contenu non obtenu) : **ne pas citer comme fermeture** ; le registre indique activité.
- **Interprétation** : rentabilité réelle jusqu'en 2024, puis **résultat brut négatif sur l'exercice 2025**, donc des coûts d'achat/remises supérieurs au chiffre d'affaires net, pas simplement une hausse de frais. L'ouverture internationale et l'équipe de 9 coïncident avec la dégradation.
- **Transférable** : le contenu organique TikTok comme canal d'acquisition (pour `bm_04`). **Non transférable** : chiffres non comparables (pas de CA, DKK, marché danois).
- **Confiance** : élevée (registre) ; moyenne sur la lecture causale.

### 2.4 WOOVIN (Pays-Bas) — type B (place de marché « shop-in-shop ») — proximité : moyenne
- **Fait [E]** (presse, janvier 2026, cités sur la [page presse WOOVIN](https://woovin.com/en/press), [RetailTrends 20.01.2026](https://retailtrends.nl/news/77973/startup-van-de-maand-woovin-wil-uitgroeien-tot-het-grootste-sneakerplatform-van-europa), [De Ondernemer 27.01.2026](https://www.deondernemer.nl/retail/woovin-sneaker-uitbreiden-duitsland-sneakers-tio-laurey-platform~67ae775), Emerce) : « presque 10 M€ de CA en 2025 (+50 %) » ; ~50 000 clients ; > 500 vendeurs professionnels (NL, BE, DE, FR, AT) ; > 100 000 paires ; **commission par vente** ; lancement du site en 2023 ; levée relais été 2024 à une valorisation de **5 M€** (business angels) ; Allemagne = **20–30 % des ventes** ; **PayPal = 70–80 % des achats allemands, commission 3,5 % « sur notre bénéfice »** ; livraison moyenne 2–3 jours ; France puis Italie en 2026. Nature du « CA » (GMV ? commissions ?) **non définie** dans les sources.
- **Interprétation** : modèle sans stock ni achat à la commande ; le « CA ≈ 10 M€ » est très probablement une GMV, pas un revenu net (hypothèse non vérifiée). La leçon utile pour nous est **l'Allemagne (PayPal/facture)** et le délai de 2–3 jours.
- **Pas de lien avec la Suisse** (fiche : société néerlandaise).
- **Confiance** : faible sur les montants (déclarations), moyenne sur les mécanismes (PayPal en Allemagne corroboré par EHI, voir `bm_05`).

### 2.5 SneakerAsk (Pays-Bas) — types A+B hybride — proximité : élevée
- **Fait [P]** : un prestataire (Boris Burkhardt, Guzco, LinkedIn 31.03.2026) écrit « SneakerAsk est une **entreprise à 22 M€+** croissant de **180 % par an** » et que, avant son outil, une personne passait 3–4 h par jour sur les litiges Klarna « et en perdait 19 % » ; après outil, > 90 % de litiges gagnés. **Définition de « business » non précisée** (GMV/CA ?). [lien](https://www.linkedin.com/posts/borisburkhardt_at-22-lian-built-sneakerask-into-a-22m-activity-7444661262858272768-0Qha)
- **Fait [X]** : EcomScout (estimation algorithmique) : 167,6–383,2 k$ de CA mensuel estimé, 988,5 k visites/an, 2,5 k produits, NL 84 %, Trustpilot 4,0/5 (2 886 avis) ([page](https://ecomscout.com/stores/sneakerask.nl)).
- **Fait [E]** : fondateur Lian Gietermans (propriétaire depuis février 2021) ; **plateforme maison lancée en août 2026** (listings, payouts, comptabilité, CS, scraping concurrents) ; recherche de gros vendeurs (mars 2026) ; effectif réparti NL/Philippines/Italie (LinkedIn). Le site propose une **livraison express 48 h sur tailles sélectionnées**, paiement différé Klarna, retour 14 jours (page [À propos](https://sneakerask.com/pages/about-sneakerask), description EcomScout).
- **Interprétation** : sur 4 ans, un acteur du même type atteint probablement quelques millions de CHF-équivalent de revenus (fourchette X : 2,0–4,6 M$/an ; fourchette P : 22 M€ non défini) avec litiges de masse. Deux chiffres incompatibles → **ne pas utiliser comme référence de revenu**.
- **Transférable** : (a) disputes/retours à instrumenter (cf. nos 26 litiges perdus sur 35, fin_00 §6) ; (b) délais courts affichés sur un sous-ensemble de tailles plutôt que promesse générale.
- **Confiance** : faible sur la taille ; moyenne sur les mécanismes opérationnels.

### 2.6 Restocks B.V. et Kikikickz (NL/FR) — type B, **faillites** — proximité : moyenne (modèle), élevée (leçon)
- **Fait [A]** : rapport de curateur n°7 (08-10-2025), faillite **14-11-2023** (F.02/23/289) : « Jaar 2021 : omzet € 15 571 628, résultat −7 144 244 ; 2022 : € 105 077 544, −10 244 750 ; 2023 : € 38 445 477, −9 250 155 » ; 46 salariés au jour de la faillite ; **~17 000 paires de tiers en consignation** + ~900 en propriété. Causes (rapport) : croissance rapide, gros investissements, « **sous-estimation des aspects fiscaux, surtout la TVA, y compris à l'étranger** », financement bancaire promis non versé, chute imprévue du marché. Pas de fraude constatée par le curateur. ([rapport officiel](https://insolventies.rechtspraak.nl/Services/VerslagenService/getPdf/02_zwb_23_289_F_V_14), [BoF](https://www.businessoffashion.com/articles/sports/the-sneaker-resale-market-is-broken/), [El Confidencial](https://www.elconfidencial.com/tecnologia/2023-11-29/afectados-restocks-reventa-zapatillas-sneakers_3779293/)).
- **Fait [E]** (FashionNetwork, [lien](https://ww.fashionnetwork.com/news/Wethenew-acquires-assets-from-bankrupt-competitor-kikikickz,1627026.html)) : Kikikickz a généré « près de 20 M€ au pic » (déclaration du fondateur de Wethenew) et perdu 5 M€ sur l'exercice clos mars 2022 ; **Wethenew a racheté en avril 2024 les actifs incorporels : site, domaine, réseaux sociaux, base de données** (sans dettes ni équipe) (aussi [Selecta Bisso](https://selectabisso.com/en/wethenew-buys-its-main-competitor-kikikickz/)).
- **Interprétation** : le **domaine, la base clients et les comptes sociaux ont une valeur** même après la faillite : utile pour nos scénarios de nom/domaine (`bm_03` §7, `bm_02` §6).
- **Confiance** : élevée (rapport officiel).

### 2.7 Sneaker District (Pays-Bas) — type C, **faillite** — proximité : moyenne, leçon européenne élevée
- **Fait [A]** : faillite **21–22 novembre 2023** (Sneakerdistrict B.V. F.13/23/331 et Retail B.V. F.13/23/332) après sursis (17–20.11.2023). Rapport n°1 du 20.12.2023 : retards de livraison de « semaines à mois », surstock bradé (marges sous pression), crédit fournisseurs réduit et assureurs-crédit retirés ; **TVA due en Belgique, Allemagne et France payée à tort aux Pays-Bas → dettes fiscales de plusieurs millions d'euros**. Actifs repris par Etrias Group ; l'activité belge n'était pas en faillite ([rapport](https://www.faillissementsverslagen.com/faillissement/verslagen/verslag/13_ams_23_331_F_V_02/pdf), [FashionUnited](https://fashionunited.nl/nieuws/business/webshop-en-activa-sneaker-district-overgenomen-uit-faillissement/2023122159497), [tracker](https://insolventietracker.nl/failliet/f.13_23_332/sneakerdistrict-retail)).
- **Interprétation** : la mécanique « mauvaise TVA à l'étranger » apparaît dans **deux** faillites néerlandaises. Pour nous : mêmes risques si l'on vend en UE sans cadre IOSS/TVA clair (voir `bm_05` §4).
- **Confiance** : élevée.

### 2.8 Sneakersnstuff / SNS AB (Suède) — type C, **faillite puis reprise** — proximité : faible (détaillant à boutiques), leçon de « reset » : élevée
- **Fait [A]** : comptes 2023 (publiés 31.10.2024, via [Ehandel.se](https://www.ehandel.se/kris-i-sneakersnstuff-delar-av-verksamheten-laggs-ner-sagt-upp-personal)) : CA **581,5 MSEK** (−~10 %, 645 → 582 MSEK selon [Market.se](https://www.market.se/affarsnyheter/konkurs/sneakersbolaget-blev-globalt-gar-i-konkurs/)), résultat d'exploitation **7,5 → −30,6 MSEK** ; fermeture du Japon et des 2 boutiques US ; « incertitude significative sur la continuité » ; **faillite le 20-01-2025** ([konkurs.nu](https://www.konkurs.nu/konkurser/SNS-AB_556586-3528_7d54fd77-f4a1-4e9a-a7d7-067754adab6f)) ; nouvel acquéreur confirmé par le curateur ([Di.se](https://www.di.se/nyheter/skokedjan-raddas-ny-agare-efter-konkursen/)).
- **Fait [E]** : bilan 2025 du dirigeant (LinkedIn, [lien](https://www.linkedin.com/posts/erik-manzano-fagerlind-bb169313_2025-was-an-intense-year-for-sns-ill-try-activity-7426362119346024448-Ox2s)) : repris en mars 2025 ; migration vers le **réseau Shopify** pour transformer un coût fixe technique en coût variable ; **loyer de bureau −90 %, frais généraux −~70 %** ; CA 2025 **155 MSEK**, dont > 65 % sur les 4 derniers mois ; plan « Reset / Rebuild / Scale » jusqu'en 2028 ; « le marché reste difficile ». Aucun résultat net publié.
- **Interprétation** : un détaillant historique, 1 Md SEK de CA groupe en 2021/22, a dû être purgé avant de repartir. Le séquençage « réduire les coûts fixes → stabiliser la marge → croître » est exactement l'inverse de « lever pour croître d'abord ».
- **Confiance** : élevée sur la faillite et la reprise ; faible sur la santé actuelle (communication du dirigeant).

### 2.9 Newcop (Espagne/France) — type C (transition A → C) — proximité : moyenne, **concurrent direct en Suisse**
- **Fait [E]** (communiqué relayé par [Modaes 12.02.2026](https://www.modaes.com/empresas/la-start-up-newcop-cambia-de-modelo-adios-a-la-reventa-distribucion-y-marca-propia), [TradeSport 17.02.2026](https://www.tradesport.com/Articulos/622783-Newcop-supera-los-8-millones-de-euros-de-facturacion-en-2025.html), [FashionNetwork](https://ww.fashionnetwork.com/news/Newcop-surpassed-8-million-in-turnover-in-2025-plans-to-launch-own-brand,1808320.html)) : **8,1 M€ en 2025 (+20 %)** ; **ticket moyen 188 € (234 € en 2024)** ; « le marché de la revente a ajusté ses prix » ; **distributeur officiel adidas, Puma, Asics, UGG** et discussions avec les autres ; boutiques Barcelone, Madrid, Paris, Dubaï (une boutique barcelonaise fermée) ; commandes en ligne ×2,5 et CA en ligne ×2 après refonte de l'équipe e-commerce/paid media ; objectif 13–14 M€ en 2027 ; marque propre. **Non audité.** Le site liste Nike, New Balance, Hoka, On, Saucony en distribution officielle et **la Suisse parmi les pays livrés** ([FAQ Newcop](https://newcop.com/fr/pages/faq-personnalisee)).
- **Interprétation** : le modèle gagnant revendiqué est la **sortie ordonnée de la revente** vers la distribution officielle ; le ticket moyen baisse de ~20 %.
- **Hypothèse** : ouvrir des comptes de distribution (ASICS, UGG, New Balance, adidas…) est possible pour un acteur de ~8 M€ ; **à tester pour nous** (ticket moyen 225 CHF, 12 mois : 3 529 commandes CH).
- **Confiance** : moyenne (communiqué, non audité).

### 2.10 GOAT Group (États-Unis) — type B, acteur mondial — proximité : faible (échelle), leçon de marché : élevée
- **Fait [P/X]** : pas de comptes publics ; **effectif 1 613 (2023) → 919 (2025-12-31), −43 %** (Revelio Labs cité par [WillItSurvive](https://willitsurvive.net/c/goat/), 2026-07-22) ; dernière levée Série F juin 2021 à 3,7 Md$ ; fermeture des installations Alias au Royaume-Uni, Hong Kong, Japon en sept. 2025 ([Sole Retriever](https://www.soleretriever.com/news/articles/goat-shutting-down-facilities-in-uk-asia)) ; licenciements et fermetures de centres de dépôt Miami/LA en 2026 ([Substack](https://brandon1an.substack.com/p/brandons-sneaker-news-roundup-volume-f3e)). Estimations de revenu incompatibles (126,7 M$ à 795,7 M$) — non utilisables. Stadium Goods : **non étudié** (pas de source récupérée).
- **Fait [A/P]** : [BoF](https://www.businessoffashion.com/articles/sports/the-sneaker-resale-market-is-broken/) (2024) : « le marché de la revente se contracte » ; Nike et adidas ont abandonné le modèle de rareté ; les géants (StockX, GOAT, Stadium Goods) tiennent en se diversifiant (Grailed, cartes, consoles).
- **Fait [P] (biaisé)** : RestocksAIO (outil pour revendeurs) publie un indice de ventes revente enregistrées à **85,9 % du pic en 2023, 36,2 % en 2024, 13,6 % en 2025** sur son propre panel ([page](https://restock.gg/tools/sneaker-resale-market)) : **panel de clients d'un outil de bots, pas une mesure du marché**.
- **Interprétation** : même les leaders réduisent. La revente à marge élevée sur des sorties limitées est une classe d'actifs en décroissance ; ce n'est pas une preuve contre notre modèle (assortiment orienté produits courants : prix moyen 225 CHF, 77,5 % sneakers) mais un signal contre le pari « growth by scarcity ».
- **Confiance** : moyenne sur la tendance (plusieurs sources convergentes mais pas officielles).

---

## 3. Contre-exemples et cas non retenus
- **Sneak City** : aucun enregistrement de société suisse « Sneak City » ou faillite associée trouvé dans les résultats ; le seul « Sneaker City » trouvé est un thème WordPress de démonstration (AdForest). **Non retenu.** Pour vérifier : rechercher la raison sociale exacte ou le n° IDE dans [Zefix](https://www.zefix.admin.ch/en/search/entity/welcome) et la [FOSC/SHAB](https://zefix.ch/en/search/shab/welcome).
- **VADITIM GmbH** (Freienbach/Pfäffikon SZ, IDE CHE-291.802.230) : faillite ouverte le **12-08-2026** (Bezirksgericht Höfe, SHAB 20.08.2026), but statutaire « commerce en ligne de produits de toute nature et marketing de produits via les réseaux sociaux » ([SHAB](https://www.shab.ch/shabforms/servlet/Search?DOCID=HR01-1005369576&EID=7), [OnlineInfo](https://onlineinfo.ch/firma/vaditim-gmbh-in-liquidation---che-291-802-230)). **Je n'ai pas la preuve qu'elle exploitait un site de sneakers** ; non retenu comme cas, signalé comme piste à vérifier par l'utilisateur.
- **Sneakers.com / Flight Club / Stadium Goods / Kicks Crew** : non étudiés au-delà de GOAT Group (aucune donnée primaire récupérée).

## 4. Concurrence directe en Suisse (carte, pas des « cas à résultats »)
Sources : recherche web du 2026-11-02, pages produit publiques ; **aucune donnée financière** retrouvée.

| Acteur | Positionnement affiché | Délai affiché | Retours affichés | Source |
|---|---|---|---|---|
| **SN Zürich** | Jordan 4 Red Cement à 420 CHF, stock faible | 1–3 jours ouvrables | 14 jours, non portés | [sneakerzh.ch](https://sneakerzh.ch/fr/products/jordan-4-retro-red-cement) |
| **YLB Concept** (Yverdon) | prix par taille, retrait gratuit à Yverdon, « 10 450 articles ajoutés depuis le 1er octobre » (affirmation du site) | 7–14 j. ouvrables (indicatif) | 14 jours non porté | [ylbconcept.ch](https://ylbconcept.ch/en/) |
| **Hypedstuff** | prix fixes, « plus de 5 500 clients satisfaits » (site) | 3–10 j. ouvrables | **non** (sauf défaut) | [hypedstuff.ch](https://hypedstuff.ch/en) |
| **Newsole** | livraison gratuite CH | 2–12 j. ouvrables | 7 jours | [newsole.ch](https://newsole.ch/product/jordan-4-retro-white-thunder/) |
| **SYSTRAM Resell** | demande + offre selon le marché StockX/GOAT, frères valaisans | n/d | n/d | [shop.systram.com](https://shop.systram.com/) |
| **Footshop** (nouveau en CH) | douane et TVA incluses, 30 jours de retour | n/d | 30 jours | [footshop.ch](https://www.footshop.ch/de/) |
| **Newcop** | ship to Switzerland (FAQ) | n/d | n/d | cf. §2.9 |
| **Resell Lausanne (nous)** | « Livraison 48H » en bandeau d'accueil ; fiche produit : standard 5–10 j. ouvrés, express 2–5 | **médiane réelle 13 j.o. standard** (cx_01) | 14 j., échange/crédit, frais 10 % | site 2026-11-02 |

- **Fait** : sur la requête « où acheter sneakers authentiques Suisse Jordan 4 », la réponse synthétique recommande SN Zürich en premier (livraison 1–3 jours) et cite **deux de nos pages**, avec la mention « express 2–5 jours » ; sur la requête « StockX alternative Switzerland », elle place YLB Concept en tête et décrit Resell Lausanne avec « 48-hour delivery » (WebSearch, 2026-11-02 ; **un seul test, non reproductible**).
- **Interprétation** : nos promesses affichées sont **au niveau** de la concurrence mais nos délais réels ne le sont pas (voir `cx_01`, `fin_00 §7`). Le différenciateur « délai » est perdu tant que l'achat est différé de 5 jours (cron « cashflow lag buy », fin_00 §7).

---

## 5. Enseignements (Fait → Interprétation → Reco → Confiance)

| # | Fait observé | Interprétation | Reco (mécanisme) | Confiance |
|---|---|---|---|---|
| E1 | SneakerHype : retours non adossés au fournisseur → stock ; prix en baisse avec tirages plus grands [A] | Le risque de stock mort s'applique à toute promesse de retour sur un achat à la commande | Faire coïncider la politique de retour client avec la possibilité réelle de retour fournisseur ; chiffrer le taux de stock « retourné non revendable » (nos 65 jours de délai de remboursement sur #6200, fin_00 §6) | élevée |
| E2 | Restocks et Sneaker District : TVA étrangère mal traitée → millions de dettes [A] | L'international est d'abord un risque fiscal | Pas d'ouverture UE sans validation écrite fiscaliste TVA/douane et simulation (voir `bm_05`) | élevée |
| E3 | Sneakersnstuff : baisse des coûts fixes de 70 % avant de croître [E] | Le « reset » précède la croissance | Plan 2 sem./2 mois : réduire coûts fixes, stabiliser la marge avant tout financement | moyenne |
| E4 | Newcop : sortie de la revente vers la distribution officielle, ticket −20 % [E] | La marge sur revente se comprime ; l'accès marque est un levier | Tester la demande d'ouverture de comptes (sans contact tant que l'audit est read-only) ; décision utilisateur | moyenne |
| E5 | The Sneaker Store : résultat brut négatif 2025 après expansion [A] | Croissance de l'équipe/pays avant stabilité de marge = alerte | Ne pas dupliquer des coûts de structure sans marge brute stable | moyenne |
| E6 | Limited Resell : levées 0,43–0,9 M€, RJ juillet 2026 [A][E] | Levée ≠ viabilité | Exiger des preuves (contribution après pub positive 3 mois consécutifs) avant d'engager de l'argent externe (`fin_*` du pilote) | élevée |
| E7 | WOOVIN, SneakerAsk : chiffres non définis [E][P] | Ne pas fonder un objectif de CA sur eux | N'utiliser que les mécanismes (PayPal DE, litiges Klarna, express sur sélection) | élevée |
| E8 | Kikikickz : domaine + base + réseaux rachetés après faillite [E] | Ces actifs ont de la valeur | Garder la maîtrise du domaine et de la base clients dans tout scénario de nom (`bm_03`) | moyenne |

---

## 6. Tableau de comparabilité (obligatoire §12)

Légende proximité : 3 = très proche de nous (même modèle/assortiment/taille), 2 = partielle, 1 = faible. Chiffres : monnaie d'origine, nature et période indiquées. Preuve A/E/P/X comme défini plus haut.

| Cas | Pays | Modèle | Sourcing | Stock | Canaux | Prox. | Dates clés | Chiffres (nature, période) | Preuve | Financement/équipe | Statut 2026-11-02 | Transférable | Non transférable |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **SneakerHype** | NL | A achat sur demande | « kochten in op aanvraag » | faible (300 paires à la faillite) | e-shop + showroom (2023) | 3 | VOF → BV 09.2024 ; faillite 20.05.2025 | CA 550 052 € (« 2025 », période floue), résultat −52 328 € | A | 3 → 10 → 2 employés | **faillite** | retours/stock, écart de prix | boutique physique |
| **Limited Resell** | FR | A+D | revente, B2B, collectibles | n/d | e-shop, B2B marketplaces | 3 | 2020 ; 2023–24 levées ; RJ 16.07.2026 | CA 2024 (12 m) 2 407 950 € ; 2025 (21 m) 2 487 847 € | A (administrateur) | 430 785 € crowd + total 900 k€ [E] ; 6–10 pers. | **RJ, reprise en cours** | piège expansion/levée | cause réelle inconnue |
| **The Sneaker Store** | DK | C | revendeur multi-marques | oui (actifs circulants 2,25 M DKK) | e-shop DK/SE | 2 | 2021 ; 2023 pic | résultat brut 2025 −94 k DKK ; net −3,15 M DKK | A | ~9 employés | actif, fonds propres −0,8 M DKK | contenu TikTok | CA non publié ; autre marché |
| **WOOVIN** | NL | B | vendeurs pro, commission | pas de stock propre | site, DE/FR/IT | 2 | 2023 lancement ; 2024 bridge 5 M€ ; 2026 FR/IT | « ≈ 10 M€ en 2025 » (non défini) | E | 5 M€ valorisation | actif | PayPal DE, délais 2–3 j | modèle marketplace |
| **SneakerAsk** | NL | A+B | stock + vendeurs ; plateforme maison 08.2026 | oui | e-shop NL/BE | 3 | 2021 ; 08.2026 plateforme | « 22 M€+ » [P] ; 2,0–4,6 M$ [X] | P/X | 12 pers. (site) / 1–10 (LinkedIn) | actif | litiges, express ciblé | chiffres incohérents |
| **Restocks/Kikikickz** | NL/FR | B consignation | vendeurs particuliers | 17 000 paires de tiers | plateforme EU | 2 | 2019 ; reprise Kikikickz ; faillite 14.11.2023 | CA 15,6 → 105,1 → 38,4 M€ ; pertes 7,1 / 10,2 / 9,3 M€ | A | 46 salariés | **faillite** | TVA UE, marché | consignation |
| **Sneaker District** | NL | C | détail | oui | e-shop BE/DE/FR | 2 | faillite 21–22.11.2023 | dettes fiscales « plusieurs M€ » | A | n/d | **faillite, actifs repris** | TVA | boutique |
| **Sneakersnstuff** | SE | C | détail multi-marques | oui | boutiques + e-shop | 1 | 2000 ; faillite 20.01.2025 ; reprise 03.2025 | CA 2023 581,5 MSEK, rés. exp. −30,6 MSEK ; 2025 155 MSEK | A/E | FSN Capital (avant) | repris, « reset » | séquence coûts → marge → croissance | échelle |
| **Newcop** | ES | C (ex-A) | distribution officielle + achats | oui | 4 boutiques + e-shop | 2 | 2022 ; 2025 transition | CA 2025 8,1 M€ ; ticket 188 € (234 € en 2024) | E | fondateurs | actif | accès marque | boutiques ; non audité |
| **GOAT Group** | US | B | marketplace + Flight Club | consignation | app, 170 pays | 1 | 2021 série F ; 2025–26 fermetures | n/d (estimations 126,7–795,7 M$) | P/X | −43 % effectif | actif, contraction | tendance marché | échelle |

---

## 7. Limites et données manquantes
- **Aucun chiffre audité** pour SneakerAsk, WOOVIN, Newcop, GOAT : dire « CA » pour ces cas serait faux sans définition. SneakerHype : la « période 2025 » du rapport du curateur n'est pas définie (BV créée en 09.2024).
- **Limited Resell** : cause de la procédure et issue de la reprise non publiées ; le site de la fiche greffe (« CA 2024 : 0 € ») contredit l'administrateur. Vérification complète : **BODACC** et greffe du tribunal de commerce de Nice (non consultés directement ; relayés par agrégateurs).
- **The Sneaker Store** : CA non publié ; contenu de l'article RetailNews non obtenu ; date de l'article Nordjyske non retrouvée.
- **Stadium Goods, Flight Club, Kicks Crew, StockX** : pas de source primaire récupérée. **Sneak City** : non identifié. **Vaditim** : activité non prouvée.
- **Concurrents suisses** : prix/délais lus sur pages produit isolées, pas un relevé systématique ; aucune donnée financière.
- **Un seul test d'assistant de recherche** pour la visibilité (WebSearch, 2026-11-02), non reproductible, fourni à titre indicatif.
- Ce que je ne sais pas du tout : la marge brute réelle des concurrents suisses, leur sourcing (certains disent « directement de magasins de détail », Newsole), et le volume suisse du marché de la revente (aucune source officielle trouvée).
- **Information réellement utile à fournir par l'utilisateur** : confirmer si Vaditim/Sneak City sont des noms entendus dans des échanges précédents (le brief parle de « cas externes cités ») ; sinon ces deux cas resteront non vérifiés.
