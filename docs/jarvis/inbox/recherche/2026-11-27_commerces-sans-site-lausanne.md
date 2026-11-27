# Commerces locaux sans site web, région de Lausanne (étape 1)

Date de consultation de toutes les sources : **2026-11-27**.
Statut : recherche seule, lecture seule. Aucun contact initié (ni appel, ni email, ni formulaire). Décision de suite : Théo, après revue.

## 1. Résumé

- **10 candidats « confirmés »**, **8 « incertains »**, **5 écartés** (un site officiel existe, découvert pendant la vérification).
- « Confirmé » veut dire : probabilité très haute, **pas 100 %**. Raison : Google Search (captcha) et DuckDuckGo (captcha) étaient inaccessibles, Bing headless renvoyait des résultats hors sujet. Voir §6 Limites.
- Critère « confirmé » (les 4 conditions) :
  1. la fiche Google Maps ne porte aucun lien site et affiche le bouton « Ajouter un site Web » (lu sur la page rendue le 2026-11-27) ;
  2. aucun site propre dans au moins 3 annuaires ou agrégateurs (local.ch, search.ch, SwissYP, cylex, etc.) ni dans les résultats du moteur de recherche web utilisé (nom + adresse) ;
  3. aucun domaine évident résolvable (tests DNS `.ch` / `.com` sur variantes du nom) ;
  4. aucune page Facebook/Instagram présentée comme site officiel.
- Constat important : les annuaires qui recopient Google (ex. coiffeursuisse.com) sont périmés. Exemple : « Coiffure Riki » (Renens) y figure « Pas de site web » alors que sa fiche Maps affiche aujourd'hui `www-barber.com`. Je n'ai donc retenu aucun candidat sur la seule foi d'un annuaire.
- Les photos : toutes les fiches retenues affichent une photo de couverture exploitable (vue sur capture de la fiche Maps). Le **nombre exact de photos n'est pas exposé** par la vue Maps « limitée » utilisée ici. Aucun nombre n'est donc inventé (voir §6).

## 2. Méthode (ce qui a réellement été fait)

1. **Repérage Google Maps** : Chrome headless (Playwright) sur `google.com/maps`, locale `fr-CH`. 20 catégories (restaurant, coiffeur, boulangerie, fleuriste, garage, cordonnier, retouches, boucherie, épicerie, café, institut de beauté, barbier, pizzeria, artisan, pressing, tatouage, massage, peintre, kiosque, magasin) × 11 communes (Lausanne, Renens, Prilly, Pully, Lutry, Epalinges, Crissier, Ecublens, Morges, Bussigny, Le Mont-sur-Lausanne) → 4 307 fiches uniques. <!-- pragma: allowlist secret -->
2. **Échantillon** : retrait des chaînes et institutions par mot-clé, tirage aléatoire de 900 fiches, lecture détaillée de **360 fiches** (le reste a expiré sous le débit de Google). Sur ces 360, **83 (23 %)** n'avaient aucun lien site sur la fiche. Ce n'est pas un recensement exhaustif.
3. **Présélection** de 26 fiches sans lien site, avec photo de couverture (vue sur capture), indépendantes (hors chaînes). Pour chacune :
   - relecture de la page Maps : présence de « Ajouter un site Web », lien `authority` absent, liens de réservation/social éventuels, capture de la photo de couverture ;
   - test DNS (`getent hosts`) de 2 à 5 variantes de domaine `.ch`/`.com`, puis lecture (`curl`) de tout domaine résolu ;
   - requêtes du moteur de recherche web (outil WebSearch) : `nom + adresse`, parfois `nom + instagram/facebook`, lues pour y chercher un domaine propre ;
   - lecture des fiches annuaires remontées (local.ch, search.ch, SwissYP, cylex, etc.) et, pour l'existence légale, OpenFirm / Moneyhouse / FAO Vaud (données Zefix/FOSC).
4. Fiches écartées dès qu'un site officiel apparaissait (§5). Fiches « incertaines » = indice contradictoire (domaine parqué, site cité par un annuaire mais domaine mort, etc.).
5. Aucun formulaire, email ou appel. Aucun compte créé. Aucune écriture hors de ce fichier.

Script de collecte : temporaire, non versionné (aucun code modifié dans le dépôt).

## 3. Tableau récapitulatif

Légende photos : « couv. » = photo de couverture vue sur la fiche Maps. Nombre d'avis = valeur lue (Maps ou miroir cité), non garantie à jour.

| # | Commerce | Commune | Activité | Statut | Avis / note (source) | Photos (estimation) |
|---|---|---|---|---|---|---|
| 1 | Atelier de Couture Maguy | Lausanne | Couture, retouches | **Confirmé** | 4,2 (Maps) | couv. : machine à coudre, outils |
| 2 | Maison Perle | Crissier | Institut de beauté | **Confirmé** (réserve : page de réservation Salonkee) | 4,9, 81 avis (miroir Exa) | couv. : intérieur clair, soigné |
| 3 | Doune Tattoo | Lausanne | Tatouage | **Confirmé** | 5,0, 27 avis (miroir Exa) | couv. : réalisation tatouage |
| 4 | Purple Snow Tattoo | Cheseaux-sur-Lausanne | Tatouage | **Confirmé** | 5,0, 4 avis (miroir Exa) | couv. : studio / poste de travail |
| 5 | Coiffure des Alpes | Pully | Salon de coiffure | **Confirmé** | 5,0, 1 avis (miroir Exa) | couv. : intérieur du salon |
| 6 | Le Petit Magasin | Denges | Épicerie de village | **Confirmé** | 4,8, 16 avis (miroir Exa) | couv. : devanture, étal |
| 7 | Épicerie du Mont-Goulin | Prilly | Épicerie de quartier | **Confirmé** | 4,8, 16 avis (miroir Exa) | couv. : rayons bien remplis |
| 8 | Pache & Fils SA | Le Mont-sur-Lausanne | Maçonnerie, carrelage | **Confirmé** | 5,0 (Maps) | couv. : bâtiment / dépôt (peu vitrine) |
| 9 | Carrosserie Class | Renens | Carrosserie | **Confirmé** | 4,3, 10 avis (miroir Exa) | couv. : voitures rouges en atelier |
| 10 | BİLOO Barber Shop | Lausanne | Barbier | **Confirmé** (réserve : Fresha + page annuaire) | 4,9, 127 avis (miroir Exa) | couv. : coupe, ambiance barbier |
| 11 | Raja Food | Lausanne | Épicerie | **Incertain** | 4,5, 67 avis (miroir Exa) | couv. : devanture ; « 8 photos » (Waze) |
| 12 | Chez Sanga | Lausanne | Épicerie fine | **Incertain** | 5,0 (Maps) | couv. : étal fruits / légumes |
| 13 | KéTaLa bouTiqUe | Lausanne | Boutique créateurs | **Incertain** | 4,3, 48 avis (miroir Exa) | couv. : vitrine |
| 14 | Glaces & Sorbets Bougainvillier | Morges | Glacier artisanal | **Incertain** | 4,9, 86 avis (miroir Exa) | couv. : terrasse colorée ; « 2 photos » (g4local) |
| 15 | Amoda Boutique | Morges | Boutique de mode | **Incertain** | 5,0, 8 avis (miroir Exa) | couv. : vitrine |
| 16 | Pressing Plus-Net | Chavannes-près-Renens | Pressing | **Incertain** | 4,9 (Maps) | couv. : intérieur, vêtements |
| 17 | Fleurs de Saint Roch | Lausanne | Fleuriste | **Incertain** | 4,5, 23 avis (miroir Exa) | couv. : vitrine fleurie |
| 18 | TM Automobiles Sàrl | Ecublens (siège légal : Villars-Ste-Croix) | Carrosserie / garage | **Incertain** | 5,0, 3 avis (miroir Exa) | couv. : voiture sur pont |

Écartés (site officiel trouvé) : voir §5.

## 4. Fiches détaillées

Format commun : lien Maps = page de la fiche telle qu'ouverte le 2026-11-27. « Vérification » = méthode exacte. « Contact » = ce qui est affiché publiquement sur la fiche Maps. Pour tous : lecture Maps du 2026-11-27 = lien site absent + texte « Ajouter un site Web » présent.

### 4.1 Confirmés

#### 1. Atelier de Couture Maguy (Lausanne)
- Adresse : Avenue Alexandre-Vinet 18, 1004 Lausanne. Activité : atelier de couture, retouches, confection sur mesure, cours.
- Maps : [fiche](https://www.google.com/maps/place/Atelier+de+Couture+Maguy/data=!4m7!3m6!1s0x478c2f5bf551f46b:0x47ef36d749a5aaf6!8m2!3d46.5258963!4d6.6296729!16s%2Fg%2F11hdz87jbr!19sChIJa_RR9VsvjEcR9qqlSdc270c) (fiche non revendiquée : « Revendiquer cet établissement » affiché).
- Vérification : Maps (pas de lien, « Ajouter un site Web ») ; recherche web « Atelier de Couture Maguy Avenue Alexandre-Vinet 18 Lausanne » : seulement annuaires [FRC Bonnes adresses](https://adresses.frc.ch/adresses/atelier-de-coutur-maguy/), [Lausanne-répare](https://www.lausanne-repare.ch/recherche/fiche), [Loopli](https://www.loopli.ch/fr/annuaire/vaud/reparation-retouche/atelier-de-couture-maguy-3027) (aucun ne donne de site) ; recherche « … facebook OR instagram » : aucun profil trouvé ; DNS `ateliercouturemaguy`, `maguycouture`, `ateliermaguy` en `.ch`/`.com` : aucun.
- Photos : couverture nette (machine à coudre, ciseaux). Nombre exact inconnu. Photo de couverture : [lien Maps](https://www.google.com/maps/place/Atelier+de+Couture+Maguy/data=!4m7!3m6!1s0x478c2f5bf551f46b:0x47ef36d749a5aaf6!8m2!3d46.5258963!4d6.6296729!16s%2Fg%2F11hdz87jbr!19sChIJa_RR9VsvjEcR9qqlSdc270c).
- Contact public : +41 76 581 11 05 (fiche Maps, annuaires ci-dessus). Horaires annuaires : lu-ve 9h-12h / 13h-18h.

#### 2. Maison Perle (Crissier)
- Adresse : Chemin des Lentillières 13C, 1023 Crissier (quartier Oassis). Activité : institut de beauté (soins visage/corps, épilation laser, ongles).
- Maps : [fiche](https://www.google.com/maps/place/Maison+Perle/data=!4m7!3m6!1s0x478c310072d777bd:0xae8427a00f61825a!8m2!3d46.5504839!4d6.5744763!16s%2Fg%2F11m5f8rqmd!19sChIJvXfXcgAxjEcRWoJhD6AnhK4).
- Vérification : Maps (pas de `authority` ; seul lien = réservation Salonkee) ; recherche web (nom + adresse, nom + instagram/facebook) : [Salonkee](https://salonkee.ch/salon/maison-perle), [OASSIS](https://oassis.ch/enseigne/maison-perle/), [Body Pass](https://www.bodypass.ch/etablissements/maison-perle/), aucun site propre, aucun compte social officiel cité ; DNS `maisonperle.com`, `maison-perle.com` résolvent mais sont des pages de revente / protection anti-bot (non lisibles, sans lien avec le salon dans aucun résultat) ; `maisonperle.ch` : aucun.
- Réserve : Salonkee est une page de réservation tierce, pas un site officiel. Les domaines `.com` n'ont pas pu être lus (403 anti-bot) : légère incertitude résiduelle.
- Photos : couverture très travaillée (espace clair, décor). Nombre exact inconnu. Fiche Salonkee avec description riche (31 avis vérifiés Salonkee, 2026-11-27).
- Contact public : +41 21 214 38 22.

#### 3. Doune Tattoo (Lausanne)
- Adresse : Rue de la Louve 12, 1003 Lausanne. Activité : studio de tatouage (artiste indépendant).
- Maps : [fiche](https://www.google.com/maps/place/Doune+Tattoo/data=!4m7!3m6!1s0x478c43e3aaeb1ec3:0xd0f6f1ac9bcdd98b!8m2!3d46.5214701!4d6.6320559!16s%2Fg%2F11wfpp4hb9!19sChIJwx7rquNDjEcRi9nNm6zx9tA).
- Vérification : Maps ; recherches web « Doune Tattoo Rue de la Louve 12 Lausanne » et « Doune Tattoo Lausanne instagram » : seulement le miroir [Exa](https://exa.ai/library/place/pz6zn36ftkp) ; les autres « Doune Tatoo » trouvés sont en France (Varennes-sur-Loire, [MonTatoueur](https://www.montatoueur.fr/tatoueurs/135-doune-tatoo)) : homonyme, à ne pas confondre ; DNS `dounetattoo`, `doune-tattoo` : aucun ; aucun compte Instagram/Facebook trouvé (peu probable qu'il n'y en ait pas : non vérifiable sans Google/Instagram).
- Photos : couverture = tatouage réalisé, bonne qualité. Nombre exact inconnu.
- Contact public : +41 79 848 61 27 (numéro mobile affiché sur la fiche Maps, activité indépendante).

#### 4. Purple Snow Tattoo (Cheseaux-sur-Lausanne)
- Adresse : Route d'Yverdon 1, 1033 Cheseaux-sur-Lausanne. Activité : tatouage.
- Maps : [fiche](https://www.google.com/maps/place/Purple+Snow+Tattoo/data=!4m7!3m6!1s0x478c338f4d391e33:0x52332753f2c2c067!8m2!3d46.5859376!4d6.6049201!16s%2Fg%2F11syc2x2zw!19sChIJMx45TY8zjEcRZ8DC8lMnM1I).
- Vérification : Maps ; recherche web « Purple Snow Tattoo Cheseaux-sur-Lausanne Route d'Yverdon 1 » : [Exa](https://exa.ai/library/place/7bjfn35v62l), [Lozart](https://lozart.ch/tattoostudio/lausanne/purple-snow-tattoo/) (4 avis), annuaire commune [cheseaux.ch](https://www.cheseaux.ch/fr/annuaire-110.html) (n'y figure pas) ; DNS `purplesnowtattoo.*` : aucun ; `purplesnow.com` résout mais renvoie 403 (probablement sans rapport, non lisible).
- Photos : couverture = poste de travail du studio, correcte. Nombre exact inconnu. Seulement 4 avis : fiche récente ou peu active.
- Contact public : +41 78 903 80 49 (fiche Maps).

#### 5. Coiffure des Alpes (Pully)
- Adresse : Avenue des Alpes 12A, 1009 Pully. Activité : salon de coiffure.
- Maps : [fiche](https://www.google.com/maps/place/Coiffure+des+Alpes/data=!4m7!3m6!1s0x478c2f74264fa47f:0xe1f19dde13067c6b!8m2!3d46.5150123!4d6.6607191!16s%2Fg%2F11kpnt50j7!19sChIJf6RPJnQvjEcRa3wGE96d8eE).
- Vérification : Maps ; recherche web nom + adresse : [local.ch](https://www.local.ch/fr/d/pully/1009/coiffeur/coiffure-des-alpes-xx_LIoKdO_NR_fW3XOdbMQ) (« Entreprise non revendiquée », pas de site), [coif.ch](https://coif.ch/en/salon/coiffure-des-alpes-pully-1009), [better-search.ch](https://www.better-search.ch/de/detail/coiffure-des-alpes-pully-avenue-des-alpes), [Exa](https://exa.ai/library/place/l4gswnn5hhz) : aucun site ; DNS `coiffuredesalpes`, `coiffure-des-alpes` : aucun.
- Particularité : le même numéro (021 728 08 59) apparaît aussi sur la fiche voisine « Salon de coiffure Francine » (Av. des Alpes 12), possible doublon ou ancien nom (miroir Exa). À clarifier avant tout travail.
- Photos : couverture = intérieur du salon, correcte. Nombre exact inconnu. 1 seul avis.
- Contact public : +41 21 728 08 59.

#### 6. Le Petit Magasin (Denges)
- Adresse : Place des Ochettes 4, 1026 Denges. Activité : épicerie / commerce de proximité de village.
- Maps : [fiche](https://www.google.com/maps/place/Le+Petit+Magasin/data=!4m7!3m6!1s0x478c31093d1b2ccd:0xcc6d628123eede0d!8m2!3d46.5247071!4d6.5409332!16s%2Fg%2F11x5n_9vqn!19sChIJzSwbPQkxjEcRDd7uI4Fibcw).
- Vérification : Maps ; recherche web nom + adresse : [Exa](https://exa.ai/library/place/yswfr828bsq), [Mapcarta](https://mapcarta.com/N13596475944) (OpenStreetMap), liste de revendeurs d'un fournisseur ([Le Petit Encas](https://lepetitencas.ch/revendeurs/)) : aucun site propre ; DNS `lepetitmagasin.ch` : aucun ; `lepetitmagasin.com` pointe vers un site sans rapport (équipement hôtelier, `hotelequipment.fr`).
- Photos : couverture = devanture et étal, correcte. Nombre exact inconnu.
- Contact public : +41 21 611 76 76. Horaires miroir Exa : lu-ve 7h30-19h, sa 7h30-18h, di 7h30-13h.

#### 7. Épicerie du Mont-Goulin (Prilly)
- Adresse : Avenue de Mont-Goulin 25, 1008 Prilly. Activité : épicerie de quartier.
- Maps : [fiche](https://www.google.com/maps/place/Epicerie+Du+Mont-Goulin,+Ispir/data=!4m7!3m6!1s0x478c31e81a10d973:0xf69760da8c2836eb!8m2!3d46.5382541!4d6.6102159!16s%2Fg%2F1hc4ssy1c!19sChIJc9kQGugxjEcR6zYojNpgl_Y).
- Vérification : Maps ; recherche web nom + adresse : [local.ch](https://www.local.ch/fr/d/prilly/1008/epicerie/epicerie-du-mont-goulin-_s6JclIDfM-dqnf4DHtseg), [SwissYP](https://www.swissyp.com/en/pro/epicerie-du-mont-goulin) (dernière vérification officielle 2026-11-08), [Lozart](https://lozart.ch/supermarkt/renens/epicerie-du-mont-goulin-ispir/), [Exa](https://exa.ai/library/place/zlh1jgqf44p) : aucun site ; DNS `montgoulin`, `epiceriemontgoulin` : aucun.
- Photos : couverture = rayons très remplis, bonne. Nombre exact inconnu.
- Contact public : +41 21 647 75 70 (fiche Maps). Attention : local.ch/SwissYP affichent un autre numéro (mobile) : non repris ici.

#### 8. Pache & Fils SA (Le Mont-sur-Lausanne)
- Adresse : Chemin de Budron A 4, 1052 Le Mont-sur-Lausanne. Activité : entreprise de maçonnerie et carrelage (bâtiment, génie civil).
- Maps : [fiche](https://www.google.com/maps/place/Pache+%26+Fils+SA/data=!4m7!3m6!1s0x478c2d09753307bd:0x8a4df484ee13cf68!8m2!3d46.57046!4d6.633075!16s%2Fg%2F11fn9dbz16!19sChIJvQczdQktjEcRaM8T7oT0TYo).
- Vérification : Maps ; recherche web nom + adresse : [commune du Mont](https://www.lemontsurlausanne.ch/vivre-au-mont/entreprises/liste-des-entreprises/detail-entreprise/pache-fils-sa), [local.ch](https://www.local.ch/fr/d/le-mont-sur-lausanne/1052/maconnerie/pache-fils-sa-P8Pwb9M3_s2GLq3FolQxfQ), [search.ch](https://search.ch/tel/le-mont-sur-lausanne/chemin-de-budron-a-4/pache-fils-sa), [ZIP.ch](https://zip.ch/fr/pache-fils-sa-chemin-de-budron-a-le-montsurlausanne-rDmoxvGKJn/), [EDIREX](https://edirex.ch/fr/annuaire/pache-fils-sa) : aucun site, email générique `@bluewin.ch` ; DNS `pache-fils`, `pachefils`, `pachefils-sa` en `.ch` : aucun.
- Photos : couverture = bâtiment/terrain, peu « vitrine ». Intérêt photo moyen (à vérifier : chantiers ?).
- Contact public : +41 21 728 19 21 (local.ch, search.ch, Maps), email affiché sur local.ch/commune : `pache-fils@bluewin.ch`.

#### 9. Carrosserie Class (Renens)
- Adresse : Chemin du Closel 16, 1020 Renens. Activité : carrosserie automobile.
- Maps : [fiche](https://www.google.com/maps/place/Carrosserie+Class/data=!4m7!3m6!1s0x478c317139d6e7ff:0xb2fbdc8cca197096!8m2!3d46.5309656!4d6.5921933!16s%2Fg%2F11rzjfj1_d!19sChIJ_-fWOXExjEcRlnAZyozc-7I).
- Vérification : Maps ; recherche web : [Carrosserier.ch](https://carrosserier.ch/vaud/renens-vd/pro-6725-carrosserie-class-karadagli), [SwissYP](https://www.swissyp.com/pro/carrosserie-class-karadagli) (dernière vérification officielle 2026-11-21), [finde-offen.ch](https://finde-offen.ch/renens/carrosserie-class-shaqiri-karadagli-393861), [Coparking](https://coparking.ch/fr/depannage-automobile/carrosserie-class-997), [Exa](https://exa.ai/library/place/7lp6v700x8x) : aucun site ; DNS `carrosserieclass`, `carrosserie-class`, `classcarrosserie` en `.ch` : aucun.
- Photos : couverture = voitures rouges en atelier, bonne. Nombre exact inconnu. Des avis mentionnent un accueil et un travail corrects (miroir Exa, 10 avis).
- Contact public : +41 21 634 35 19.

#### 10. BİLOO Barber Shop (Lausanne)
- Adresse : Avenue Alexandre-Vinet 26/26 bis, 1004 Lausanne. Activité : barbier.
- Maps : [fiche](https://www.google.com/maps/place/B%C4%B0LOO+Barber+Shop+-+Lausanne/data=!4m7!3m6!1s0x478c2fe8d7d8e89d:0x5f8cb8a8ba8d3ef6!8m2!3d46.5265411!4d6.6286872!16s%2Fg%2F11y1yp7x3n!19sChIJnejY1-gvjEcR9j6Nuqi4jF8).
- Vérification : Maps (pas de `authority`, « Ajouter un site Web ») ; recherche web : [Fresha](https://www.fresha.com/lvp/biloo-barber-shop-avenue-alexandre-vinet-lausanne-Y0JzXb) (plateforme de réservation), [page annuaire Barber CH](https://barber.ch.ivof.com/biloo-barber-shop/) (agrégateur, pas un site propre), [OpenFirm](https://openfirm.ch/fr/entreprise/che405558530-biloo-barber-shop-sarl/) (Sàrl inscrite 2024-01-26) ; DNS `bilooshop`, `biloobarber`, `biloo` en `.ch` : aucun.
- Réserve : l'agrégateur est présenté comme « site » par le miroir Exa : ce n'est pas un site officiel. Si Théo veut être strict, requalifier en incertain.
- Photos : couverture = coupe/barbe, bonne qualité, fort volume d'avis (127). Meilleur potentiel visuel de la liste.
- Contact public : +41 79 508 20 96 (fiche Maps).

### 4.2 Incertains

#### 11. Raja Food (Lausanne)
- Adresse : Avenue de Chailly 57, 1012 Lausanne. Activité : épicerie.
- Maps : [fiche](https://www.google.com/maps/place/Raja+Food+-+%C3%A9picerie/data=!4m7!3m6!1s0x478c2e5053af67b7:0x6ce93c2164208b45!8m2!3d46.52318!4d6.6558095!16s%2Fg%2F11gfkl22hl!19sChIJt2evU1AujEcRRYsgZCE86Ww). Pas de lien site sur Maps.
- Pourquoi incertain : le domaine `rajafood.ch` est **enregistré** (page Gandi par défaut, « This domain name has been registered with Gandi.net »), propriétaire inconnu : peut appartenir au commerce (site à venir) ou à un tiers.
- Annuaires : [Waze](https://www.waze.com/fr/live-map/directions/ch/vd/lausanne/raja-food-epicerie?to=place.ChIJt2evU1AujEcRRYsgZCE86Ww) (mentionne « 8 photos »), [Ligoo](https://www.ligoo.ch/fr/1012/lausanne/alimentation-shopping-magasin-d-alimentation/raja-foods-F9RbzDoDWrDPLaOy), [Exa](https://exa.ai/library/place/wtbttxbsrt6) : aucun site.
- Photos : couverture = devanture, correcte ; 8 photos citées par Waze (source non datée).
- Contact public : +41 76 397 79 68.

#### 12. Chez Sanga (Lausanne)
- Adresse : Avenue de Montchoisi 1, 1006 Lausanne. Activité : épicerie fine / produits locaux et bio.
- Maps : [fiche](https://www.google.com/maps/place/Chez+Sanga/data=!4m7!3m6!1s0x478c2fcc63c3bb8b:0xa1aea7afe02367e0!8m2!3d46.5144355!4d6.6333288!16s%2Fg%2F1tcxc2pg!19sChIJi7vDY8wvjEcR4Gcj4K-nrqE). Pas de lien site sur Maps.
- Pourquoi incertain : l'annuaire [Yoys](https://www.yoys.ch/adresse-41-216164801-delikatessengesch%C3%A4ft-Lausanne-CH4685827.html) cite `http://www.chezsanga.ch/`. Test DNS 2026-11-27 : `chezsanga.ch` et `www.chezsanga.ch` ne résolvent pas (site mort ou domaine expiré). Existence légale : [cylex](https://www.cylex-swiss.ch/lausanne/mr-georges-sanga-11034341.html) (mise à jour 2026-06-09) liste un n° de registre du commerce.
- Photos : couverture = étal de fruits et légumes, attrayante.
- Contact public : +41 21 616 48 01.

#### 13. KéTaLa bouTiqUe (Lausanne)
- Adresse : Avenue de Béthusy 4, 1005 Lausanne. Activité : boutique de créateurs, seconde main.
- Maps : [fiche](https://www.google.com/maps/place/K%C3%A9TaLa+bouTiqUe/data=!4m7!3m6!1s0x478c2e35e48c8415:0xaad5eec19928fbd0!8m2!3d46.5210984!4d6.6406789!16s%2Fg%2F11c3k9lf4f!19sChIJFYSM5DUujEcR0PsomcHu1ao). Pas de lien site sur Maps.
- Pourquoi incertain : [GoVintage](https://govintage.ch/059811/KeTaLa_bouTiqUe) cite « Website : ketala.ch » et [cylex](https://www.cylex-swiss.ch/lausanne/k%c3%a9tala-boutique-12229216.html) un email `@ketala.ch` ; test DNS 2026-11-27 : `ketala.ch` ne résout pas. [Lausanne Tourisme](https://www.lausanne-tourisme.ch/fr/decouvrir/ketala/) lui consacre une page (avec un lien Instagram, à noter comme réseau social et non comme site).
- Photos : couverture = vitrine soignée.
- Contact public : +41 21 324 03 03.

#### 14. Glaces & Sorbets Bougainvillier (Morges)
- Adresse : Grand-Rue 24, 1110 Morges. Activité : glacier artisanal, café, crêpes.
- Maps : [fiche](https://www.google.com/maps/place/Glaces+%26+Sorbets+Bougainvillier/data=!4m7!3m6!1s0x478c37e9ac652005:0xce09d0fc72953e18!8m2!3d46.5099436!4d6.4989297!16s%2Fg%2F11fmz9cmpq!19sChIJBSBlrOk3jEcRGD6VcvzQCc4). Pas de lien site sur Maps.
- Pourquoi incertain : le miroir [Exa](https://exa.ai/library/place/sd5jd0njctn) donne un Instagram en « Website » et un email `contact@glaces-bougainvillier.ch` ; le domaine `glaces-bougainvillier.ch` résout et affiche en HTTP une page par défaut « Bienvenue sur glaces-bougainvillier.ch » (domaine réservé, pas de site). [Finde-offen](https://finde-offen.ch/morges/glaces-sorbets-bougainvillier-568571) (mise à jour 2026-08-11) renvoie vers un Linktree. Réseaux : Instagram + Facebook (non sites).
- Photos : terrasse colorée en couverture ; [g4local](https://glaces-and-sorbets-bougainvillier.g4local.com/) (miroir) indique « Photos 2 ». Avis très positifs (4,9, 86).
- Contact public : +41 79 860 27 54 ; email affiché dans le miroir Exa : `contact@glaces-bougainvillier.ch`.

#### 15. Amoda Boutique (Morges)
- Adresse : Rue Louis-de-Savoie 33, 1110 Morges. Activité : prêt-à-porter féminin et accessoires.
- Maps : [fiche](https://www.google.com/maps/place/Amoda+Boutique/data=!4m7!3m6!1s0x478c3715b5fa1803:0x290604c21d52e29b!8m2!3d46.509024!4d6.499489!16s%2Fg%2F11gdw1dhxk!19sChIJAxj6tRU3jEcRm-JSHcIEBik). Pas de lien site sur Maps.
- Pourquoi incertain : `amoda.ch` existe : page « Amoda, boutique et accessoires », message « Diese Website ist derzeit unter Bearbeitung », email `boutique@amoda.ch`, formulaire de login. Probablement le domaine du commerce, mais site vide / en construction (lié au commerce non prouvé). Annuaires : [COOR Morges](https://coor.ch/membres/boutique-amoda/), [local.ch](https://www.local.ch/fr/d/morges/1110/boutique/boutique-amoda-lNQMyRvkwOmHvr8FGgZ1uA), [Slowshopping](https://slowshopping.ch/fr/shops/amoda) : pas de lien vers `amoda.ch`.
- Photos : couverture = vitrine, correcte.
- Contact public : +41 21 802 65 50 (COOR, local.ch ; non affiché sur la fiche Maps lue).

#### 16. Pressing Plus-Net (Chavannes-près-Renens)
- Adresse : Route de la Maladière 4, 1022 Chavannes-près-Renens. Activité : pressing / blanchisserie.
- Maps : [fiche](https://www.google.com/maps/place/Pressing+Plus-Net/data=!4m7!3m6!1s0x478c31042b24373b:0xd6044645683b8756!8m2!3d46.5279939!4d6.5687919!16s%2Fg%2F11c3x3n0km!19sChIJOzckKwQxjEcRVoc7aEVGBNY). Pas de lien site sur Maps.
- Pourquoi incertain : `pressingplusnet.com` existe (page « Prochainement disponible ») ; [mappsch](https://mappsch.com/pressing-plus-net-i26273.html) affiche un lien « Webseite » non lisible ; [Yoys](https://www.yoys.ch/adresse-41-216911222-hochdruck-reinigungsdienst-Chavannes-pr%C3%A8s-Renens-CH4930203.html) renvoie vers un site auto-généré sans rapport.
- Photos : couverture = intérieur avec vêtements, correcte.
- Contact public : +41 21 691 12 22 ([ZIP.ch](https://zip.ch/fr/pressing-plus-net-route-de-la-maladiere-chavannespresrenens-WDlbOGpwJp/)).

#### 17. Fleurs de Saint Roch (Lausanne)
- Adresse : Rue Saint-Roch 6, 1004 Lausanne. Activité : fleuriste.
- Maps : [fiche](https://www.google.com/maps/place/Fleurs+de+Saint+Roch,+C.+Francfort/data=!4m7!3m6!1s0x478c2e2e4d593299:0x5b434b9d0ec3ca16!8m2!3d46.5245511!4d6.6288359!16s%2Fg%2F1tdfglg9!19sChIJmTJZTS4ujEcRFsrDDp1LQ1s). Pas de lien site sur Maps.
- Pourquoi incertain : [Firmania](https://firmania.ch/lausanne/fleurs-de-saint-roch-372448) (mise à jour 2026-08-12) et [Yably](https://yably.ch/bewertungen/lausanne/fleurs-de-saint-roch-rue-saint-roch-6) associent `larosedor.ch` (« La rose d'or, fleuriste à Lausanne », site réel) à cette adresse. Lien commerce ↔ site non prouvé (ni local.ch, qui donne un email `@bluewin.ch`, ni Maps ne le mentionnent). Peut être le même fleuriste sous une autre enseigne, ou une erreur d'agrégateur.
- Photos : couverture = vitrine fleurie, très bonne.
- Contact public : +41 21 351 25 26.

#### 18. TM Automobiles Sàrl (Ecublens)
- Adresse sur Maps : Chemin du Stand 20, 1024 Ecublens. Activité : carrosserie / garage.
- Maps : [fiche](https://www.google.com/maps/place/TM+Automobiles+S%C3%A0rl/data=!4m7!3m6!1s0x478c33000a117d5d:0xc4739672a11ac512!8m2!3d46.5330935!4d6.5637927!16s%2Fg%2F11vs11gxk6!19sChIJXX0RCgAzjEcREsUaoXKWc8Q). Pas de lien site sur Maps.
- Pourquoi incertain : adresses contradictoires : le registre (via [OpenFirm](https://openfirm.ch/fr/entreprise/che288649502-tm-automobiles-sarl/)) place le siège à Villars-Sainte-Croix (Route de Sullens 8), [local.ch](https://www.local.ch/it/d/villars-ste-croix/1029/officina-meccanica/tm-automobiles-sarl-dAmyHwkJpogLCRuCzqYPOA) à Route de Bellevue 7 avec un autre numéro. Peu d'avis (3). Aucun site trouvé, mais l'identité exacte de l'établissement reste à clarifier.
- Photos : couverture = voiture sur pont, correcte.
- Contact public : +41 76 816 52 85 (fiche Maps).

## 5. Écartés (site officiel trouvé pendant la vérification)

| Commerce | Commune | Pourquoi écarté | Source |
|---|---|---|---|
| Boulangerie Soares (« Boulangerie du Village ») | Renens | Site officiel `boulangerieduvillage.ch` (même adresse, même téléphone 021 634 06 06) | [site](https://boulangerieduvillage.ch/), [SwissYP](https://www.swissyp.com/pro/boulangerie-soares) |
| Buonissimo (traiteur / pizzeria) | Lausanne | Site officiel `buonissimo-traiteur.ch` | [Quand est-ce qu'on mange](https://quandestcequonmange.ch/buonissimo-lausanne/), [restaurants10](https://www.restaurants10.org/CH/Lausanne/122099057192016792/Buonissimo) |
| Le Monde Pizza | Renens | Même adresse et même téléphone que « Le Monde Snack Pizza », qui a un site (`monde-snack.ch`) | [monde-snack.ch](https://monde-snack.ch/foodmenu/pizzas/), [Fasteat](https://lemondesnackpizza.fasteat.ch/fr/) |
| Carrosserie Highperf SA | Renens | `highperf.ch` (boutique « HP Wear » au nom de Carrosserie Highperf SA, même numéro) | [highperf.ch](https://highperf.ch/policies/contact-information) |
| Coiffure Riki | Renens | Annuaire périmé : la fiche Maps affiche désormais `www-barber.com` (lue 2026-11-27) | [coiffeursuisse.com](https://coiffeursuisse.com/c/renens-vd/), [portrait ACR](https://commerces-renens.ch/portrait-coiffure-riki.php) |

Autres fiches de la présélection écartées sans vérification poussée : absence de photo exploitable (Boutique Plein Soleil, Cito peintures, Garage Lemanscoot, Rosa Helvetique, Coookiebakery, Studio Coiffure Epalinges), fiche introuvable dans les annuaires (Rbk coiffure, Rue du Midi 17, Renens : recherche web ne trouve aucun salon à cette adresse), société créée en 2026 (Shpet Coiffure, Prilly).

## 6. Sources datées

Date de consultation : 2026-11-27 pour toutes. « Date source » = date lue sur la page quand elle est visible, sinon « non visible ».

| Source | Usage | Date source |
|---|---|---|
| [Google Maps](https://www.google.com/maps) (fiches individuelles §4, rendu Chrome headless, vue limitée) | Absence de site, adresse, téléphone, photo de couverture, note | Avis « il y a X semaines » visibles ; fiche non datée |
| [local.ch](https://www.local.ch/fr/q/lausanne/tatouage) (fiches Coiffure des Alpes, Epicerie du Mont-Goulin, Pache & Fils, Fleurs de Saint-Roch, Amoda, Carrosserie Highperf, Buonissimo) | Annuaire, « entreprise non revendiquée », coordonnées | Source « Swisscom Directories SA », non datée |
| [search.ch](https://search.ch/tel/pully/rue-de-la-gare-1/atelier-de-couture-oksana-mamedova) (fiches Pache & Fils, requête directe Coiffure Riki) | Annuaire officiel Swisscom | non visible |
| [SwissYP](https://www.swissyp.com/pro/carrosserie-class-karadagli) | Existence, coordonnées | Dernière vérification officielle : 2026-11-21 (Carrosserie Class), 2026-11-26 (Soares), 2026-11-08 (Mont-Goulin) |
| [OpenFirm](https://openfirm.ch/fr/entreprise/che405558530-biloo-barber-shop-sarl/) (données Zefix / FOSC) | Existence légale (Biloo, TM Automobiles, Boulangerie Soares) | Inscriptions : 2024-01-26 (Biloo), 2023-10-03 (TM), 2018-12-24 (Soares) |
| [Moneyhouse](https://www.moneyhouse.ch/fr/company/carrosserie-highperf-sa-3491319791) et [FAO Vaud](https://www.faovd.ch/registre-commerce/?page=1639) | Existence légale (Carrosserie Highperf SA) | Publication FOSC 2023-08-31 / 2023-09-01 |
| [cylex-swiss.ch](https://www.cylex-swiss.ch/lausanne/mr-georges-sanga-11034341.html) | Annuaire (Chez Sanga, KéTaLa) | Dernière mise à jour : 2026-06-09 |
| [finde-offen.ch](https://finde-offen.ch/morges/glaces-sorbets-bougainvillier-568571) | Annuaire (Bougainvillier, Carrosserie Class) | Mises à jour 2026-08-11 / 2026-08-12 |
| [Firmania](https://firmania.ch/lausanne/fleurs-de-saint-roch-372448) | Annuaire (Fleurs de Saint-Roch, Studio Coiffure) | 2026-08-12 / 2026-06-08 |
| [Exa, bibliothèque de lieux](https://exa.ai/library/place/l4gswnn5hhz) (miroir de données Google Places) | Nombre d'avis, horaires, site déclaré | non visible (instantané récent) |
| [Salonkee](https://salonkee.ch/salon/maison-perle) | Plateforme de réservation (Maison Perle) | Annonce « Black Friday » datée 2026-11-27 |
| [Fresha](https://www.fresha.com/lvp/biloo-barber-shop-avenue-alexandre-vinet-lausanne-Y0JzXb) | Plateforme de réservation (Biloo) | non visible |
| [Loopli](https://www.loopli.ch/fr/annuaire/vaud/reparation-retouche/atelier-de-couture-maguy-3027), [FRC](https://adresses.frc.ch/adresses/atelier-de-coutur-maguy/), [Lausanne-répare](https://www.lausanne-repare.ch/) | Annuaires thématiques (Maguy) | non visible |
| [cheseaux.ch](https://www.cheseaux.ch/fr/annuaire-110.html), [lemontsurlausanne.ch](https://www.lemontsurlausanne.ch/vivre-au-mont/entreprises/liste-des-entreprises/detail-entreprise/pache-fils-sa), [COOR Morges](https://coor.ch/membres/boutique-amoda/) | Annuaires communaux / associatifs | non visible |
| [Lausanne Tourisme](https://www.lausanne-tourisme.ch/fr/decouvrir/ketala/), [GoVintage](https://govintage.ch/059811/KeTaLa_bouTiqUe) | KéTaLa | non visible |
| [Waze](https://www.waze.com/fr/live-map/directions/ch/vd/lausanne/raja-food-epicerie?to=place.ChIJt2evU1AujEcRRYsgZCE86Ww), [g4local](https://glaces-and-sorbets-bougainvillier.g4local.com/) | Nombre de photos affiché par des miroirs (Raja Food, Bougainvillier) | non visible ; g4local : avis jusqu'à 2025-09-02 |
| [coiffeursuisse.com](https://coiffeursuisse.com/c/renens-vd/), [ACR Renens](https://commerces-renens.ch/portrait-coiffure-riki.php) | Exemple d'annuaire périmé (Coiffure Riki) | non visible |
| Résolution DNS (`getent hosts`) et `curl` sur les domaines candidats | Test de domaine évident | exécuté le 2026-11-27 |

Moteurs de recherche : l'outil WebSearch (agrégateur) a été utilisé pour les requêtes nom + adresse. Voir limites ci-dessous.

## 7. Limites

- **Google Search inaccessible** (page « trafic exceptionnel »/captcha depuis l'IP du poste) et **DuckDuckGo html** (captcha). Bing en Chrome headless a renvoyé des résultats sans rapport (testé sur 26 candidats, abandonné). Les « recherches Google nom + ville, nom + téléphone » demandées n'ont donc **pas** été faites telles quelles ; remplacées par l'outil WebSearch (nom + adresse, parfois + instagram/facebook), et non par une recherche par numéro de téléphone isolé pour tous. Conséquence : « confirmé » ≠ 100 %.
- **Google Maps joignable** mais en « affichage limité » (headless, sans connexion). Conséquences : lien site et bouton « Ajouter un site Web » lisibles ; **nombre exact de photos non exposé** (pas de galerie ni compteur) ; navigation par flèches dans la galerie non fonctionnelle. Les « photos : couverture » ci-dessus sont des estimations qualitatives sur capture, pas des comptes. Les seuls nombres de photos cités (Raja Food « 8 », Bougainvillier « 2 ») viennent de miroirs tiers non datés.
- Nombre d'avis : repris de miroirs (Exa) pour la plupart, à jour à une date inconnue.
- **Réseaux sociaux** (Facebook/Instagram) : non vérifiés systématiquement. Lu sur les pages Maps (balayage des liens Instagram/Facebook/réservation) : aucun lien social pour les fiches #1 à #8 et #12 à #18 (seul lien tiers repéré : Salonkee pour Maison Perle) ; non scanné pour #9, #10, #11. Les recherches « … instagram/facebook » n'ont rien trouvé pour Maguy, Maison Perle, Doune Tattoo. L'absence de réseau social n'est pas établie pour les autres (pas de login Instagram/Facebook).
- Échantillon : 360 fiches lues sur 4 307 repérées (voir §2). Cette liste de 10+8 n'est pas la totalité des commerces sans site de la région.
- Les domaines en `.com` qui résolvent derrière anti-bot (Cloudflare 403) n'ont pas pu être lus (`maisonperle.com`, `maison-perle.com`, `purplesnow.com`).
- Pas de Zefix direct (accès via miroirs OpenFirm / Moneyhouse / FAO) : l'existence légale n'est vérifiée que pour les entreprises citées au §6.
- Données de contact : uniquement des coordonnées professionnelles publiques affichées sur la fiche ou l'annuaire. Pour les indépendants (tatouage, couture), le numéro affiché est un mobile : à manier avec soin si un contact est décidé plus tard.
- Aucun secret, aucun contact initié, aucun code modifié.

## 8. Points qui demandent une décision de Théo

1. **Cible** : garder les 10 « confirmés » comme liste de départ pour un éventuel démarchage, ou exiger d'abord une 2e passe (Google Search manuel, Instagram/Facebook, WhatsApp) pour atteindre ~100 % ?
2. **Incertains** : les 8 valent-ils une investigation (domaines parqués : Raja Food, Amoda, Bougainvillier, Pressing Plus-Net ; sites morts : Chez Sanga, KéTaLa) ? Un domaine parqué ou déjà réservé change l'offre (reprise du domaine plutôt que création).
3. **Secteurs prioritaires** : les photos les plus vendeuses (barbier, tatouage, institut, boulangerie, glacier) vs métiers moins « visuels » (maçon, carrosserie). Choisir un ou deux secteurs pour un pilote ?
4. **Périmètre RGPD / démarchage** : définir la règle avant tout contact (démarchage B2B suisse, usage de numéros mobiles d'indépendants, opt-out), puis qui contacte et par quel canal.
5. **Photos** : décider si le futur site réutilise les photos Google (droits d'auteur à clarifier, souvent propriété des contributeurs) ou demande les photos au commerçant.
6. **Suite de la recherche** : étendre l'échantillon (aujourd'hui 360 fiches / 4 307) à d'autres communes ou catégories ? Prévoir un accès Google Search légitime (API / SERP) pour les vérifications finales ?
