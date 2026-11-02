# Offre, marque, organisation, investissement, feuille de route, registre (S13, S16, S19, S20, S21)

Date : 2026-11-02. Base chiffrée : `fin_00`, `fin_01`, `tableaux/modele_tresorerie.xlsx`, sous-agents `ads_*`, `cx_*`, `bm_*` (avec erratum TDFN). Niveaux : **F** fait, **D** déclaré, **I** interprétation, **H** hypothèse, **R** recommandation ; confiance entre crochets.

## 1. Diagnostic en dix lignes
1. **F** Shopify 2026 (10 mois) : contribution avant pub 116 k (40,3 CHF/commande, **D** car TDFN déclaré), pub 35,0, après acquisition **+5,3** ; **I/H** résultat avant rémunération **≈ 0 à +12 k (point central +11,9 k), non démontré** : ≈ 38 k de coûts estimés (6 % du net, 12,6 % sur la cohorte récente), 211 lignes à coût 0 (→ +4,3 k si valorisées), charges fixes réelles absentes (≈ 5-15 k sur 10 mois, **H**), litiges d'août-octobre pas encore tombés ; après 6 000/mois (**H**) **≈ −48 k**. [confiance faible-moyenne]
2. **I/D/H** Galaxus (même entité) ≈ 107-122 k CHF de contribution sur 8 mois (≈ 13-15 k/mois ; NER et TDFN déclarés, coût StockX non prouvé « rendu », retours non mesurés ; ce n'est pas du cash) contre ≈ +1,2 k/mois pour Shopify avant rémunération. **I** Le résultat du dirigeant dépend surtout de Galaxus. [confiance moyenne-faible : retours/paiements Galaxus inconnus]
3. **I** Le coût marginal de la pub dépasse probablement la contribution : ≈ 42-75 CHF/commande contre 40,3 ; pub ×5,5 (15,3 k contre 2,8 k) pour commandes ×1,9 en un an, comparaison confondue par la saisonnalité (octobre 2025 = point bas, pub 2025 poussée en nov-déc). Volume hebdomadaire passé de ≈ 100-124 (août-début octobre) à 47-65 (3 dernières semaines) alors que la pub reste à ≈ 2,5-3,7 k/semaine (`tableau_bord_hebdo.csv`). [moyenne]
4. **F** Délai : commande→expédition médiane 9-14 jours, 71-96 % > 7 jours ; le site promet 5-10 j.o. (Standard) et 2-5 (Express) ; Merchant 3-6 j.o. ; seules 25 % (Standard) et 4 % (Express) des commandes échues arrivent dans la fourchette (cx). Cause : achat StockX après vente + cron de décalage de 5 jours + attente au dépôt. [haute]
5. **F** 8,4 % de remboursements (57,8 k CHF), dont 40 % d'annulations avant expédition ; 26 litiges perdus sur 35 (9,6 k) ; 93 commandes payées non expédiées ≥ 14 jours (23,4 k) dont **76 prioritaires** (> 0 CHF, ≤ 180 jours : 18,8 k, `commandes_prioritaires_14j_180j.csv`), à traiter manuellement ; liste élargie de 180 (voir `fin_00` §8). [haute pour les faits ; cause des annulations = client dans la majorité des cas documentés, lien avec les délais **I**]
6. **F** Demande très dispersée (1 633 modèles ; 20 modèles = 13 % des unités) : un stock ne couvrira qu'une minorité des ventes. [haute]
7. **I** Aucun revendeur « achat après commande » rentable et audité n'a été **trouvé dans les sources consultées** (absence de preuve ≠ preuve d'absence) ; SneakerHype (modèle identique) en faillite depuis le 20-05-2025 (rapport du curateur : retours non négociés → stock, sorties plus larges → prix en baisse, besoin de volume). [haute pour les faits, faible pour la généralisation]
8. **F** 75 % des e-mails clients partent en anglais, 41 % des sessions qui finalisent sont allemandes ; 1 016 abonnés réels sur 8 312 profils (cx). [haute]
9. **I** Le problème n'est pas le nom de marque (bm_02) : changer de nom n'a pas de preuve de bénéfice et perd des actifs (410 avis Judge.me, 525 domaines référents, trafic de marque).
10. **D** La TVA payée au forfait 2,1 % et les NER à 10 % rendent les marges Shopify/Galaxus très dépendantes de la structure fiscale ; aucun avis fiscal n'a été sollicité.

## 2. Offre et marque (S13) — la recommandation
**R1 (offre)** : *Resell Lausanne* = « la référence suisse de la sneaker et du streetwear authentiques livrés vite et honnêtement », pas « 98 000 références à tout prix ». Concrètement :
- **Cœur** : 150-300 CHF (57 % du CA) : Nike/Jordan/adidas + ASICS/NB/UGG/Saucony/Onitsuka ; mise en avant des 150-300 CHF et des modèles ≥ 10 ventes ; réduire l'assortiment actif des longues traînes qui consomment de la pub sans conversion (UGG PMax ≈ 220 CHF par conversion revendiquée).
- **Promesse** : une seule date de livraison honnête (aujourd'hui 10-13 j.o. en médiane) tant que le stock ne la raccourcit pas ; Express uniquement sur stock physique.
- **Marque** : garder le nom (option 1 de bm_02), corriger les promesses affichées (4,9 ★ « 589+ avis » contre Judge.me 410 avis ≈ 4,66 ; « 20 000 références » ; politique de retour 404).
- **Place du stock** : complément limité (pilote ≤ 4 000 CHF, cf. fin_01 §3), jamais le cœur.
- **Place de Galaxus** : moteur de contribution, à protéger (concentration, retours, délais de paiement) et à séparer comptablement de Shopify.
- **Ce que je ne ferais pas** : changement de nom, Meta/TikTok payant (8 conditions, aucune remplie), ouverture UE large (droits de douane 16,9 % ou colis refusés ; bm_05), levée de fonds.

## 3. Organisation et décisions du dirigeant (S16)
- **F** Un dirigeant (raison individuelle), outils très automatisés (≈ 126 modèles Prisma, workers VPS), peu de documents comptables dans la base (aucune charge bancaire, TVA, salaire).
- **I** Goulots : traitement manuel des commandes bloquées, décisions de pub (15 changements de tROAS en 23 jours, manuels), SAV non mesuré (aucune boîte exportée), absence de séparation Galaxus/Shopify.
- **R** (par ordre) : (1) fixer une rémunération cible et la verser depuis un compte séparé, (2) fiduciaire (TVA TDFN, comptabilité, séparation des activités), (3) règle écrite « pub » (plafond hebdomadaire et seuils d'arrêt), (4) 2 h/semaine de SAV proactif sur les commandes > 7 jours, (5) rituel hebdomadaire sur le tableau de bord.
- **Décisions qui n'appartiennent qu'au dirigeant** : structure juridique (Sàrl/SA), financement, rémunération, ventes sous le coût (102 des 125 variantes soldées, −2,9 k CHF), promesse de livraison.

## 4. Étages d'investissement (S19) — aucune dépense lancée par l'audit
| Étage | Montant plafond | Condition d'entrée | Preuve exigée | Règle d'arrêt |
|---|---|---|---|---|
| 0 Réparer | 0-2 k CHF + temps | immédiat | commandes bloquées traitées ; promesses corrigées | — |
| 1 Pub plafonnée | budget actuel −30 % (PMax) | immédiat | contribution après pub ≥ 0 sur 4 semaines | contribution après pub < 0 deux semaines consécutives |
| 2 Données/fiscalité | 1-3 k CHF (fiduciaire) | immédiat | relevés + décomptes TDFN reconstitués | — |
| 3 Stock pilote | ≤ 4 k CHF | étage 0 terminé, délai médian mesuré | rotation ≤ 30 j, ≥ 40 CHF/paire après pub | −20 % à 45 j, −30 % à 75 j |
| 4 Langue/CRM | 1-2 k CHF | étage 0 | e-mails en DE, base consentie, flux de retard | taux de désabonnement > 1 % |
| 5 UGC/contenu | 4,3 / 9,9 / 17,2 k CHF (bas/médian/haut, bm_04) | étages 0-1 validés, ROAS ≥ 5,4 | ≥ 50 commandes pour conclure | ROAS < 4 après 2 semaines |
| 6 Europe DE+AT | pilote 90 j, ≤ 60 commandes, sans pub | avis fiscal/douane | contribution ≥ 0 après droits (bm_05 : +29,9 DAP / −9,2 DDP absorbé, calculés sur l'ancienne base TVA : ≈ +11 CHF à ajouter, non recalculé) | droits absorbés ou refus de colis |
| 7 Financement externe | non défini | comptabilité propre, séparation, contribution après pub ≥ 7 CHF/cmd sur 8 sem. de cohortes mûres | cf. fin_01 §5 | — |

**Enveloppe et revues (S19.6)** : enveloppe cumulée maximale des étages 0-4 = **≈ 12 k CHF** (0-2 + 1-3 + 4 + 1-2 + pub −30 % qui économise) ; avec UGC et Europe : ≈ 12-19 k hors média. **Perte maximale acceptable proposée (H, à fixer par le dirigeant)** : 10 k CHF cumulés avant revue obligatoire. Dates de revue : **2026-11-16** (étages 0-2), **2027-01-02** (étages 3-4 selon BFCM), **2027-07-02** (étages 5-6), **2027-11-02** (étage 7). **Capital supplémentaire autorisable à chaque revue** : 0 tant que la contribution après pub sur cohortes mûres n'est pas ≥ 7 CHF/commande sur 8 semaines et que les relevés bancaires ne sont pas reconstitués ; ensuite +4 k par revue au plus.

## 5. Feuille de route (S20)
**Horizon 1 — d'ici 2026-11-16 (14 jours)** : traiter nominalement les **76 commandes prioritaires** (`commandes_prioritaires_14j_180j.csv`, extrait des 180 de `commandes_a_verifier.csv`) ; geler les tROAS 28 jours ; réduire PMax de 30-35 % ; stopper l'exposition des variantes soldées sous le coût ; corriger la promesse de livraison affichée et les mails de retard ; fournir exports bancaires, décomptes TDFN, factures Poste ; renouveler le jeton Postmark et les accès exposés. *Critère de succès* : 0 commande payée > 14 jours sans décision ; contribution après pub hebdomadaire ≥ 0.
**Horizon 2 — d'ici 2027-01-02 (BFCM/Noël)** : préparer BFCM avec les promesses corrigées, mails en DE, plafond de pub quotidien ; mesure hebdomadaire (CAC, remboursements, délai) ; stock pilote seulement après horizon 1 ; reconstituer la comptabilité 2026. *Succès* : délai médian ≤ 7 jours sur les commandes de décembre ; remboursement ≤ 7 % ; contribution après pub > 0.
**Horizon 3 — d'ici 2027-07-02** : décision sur la structure (Sàrl) ; fiducie en routine ; test DACH (si avis OK) ; flux e-mail structuré (réachat 51 j médian) ; réexamen de la rémunération ; décision stock élargi ou arrêt. *Succès* : résultat Shopify avant rémunération ≥ 3 k CHF/mois sur 6 mois consécutifs, séparation comptable Galaxus/Shopify.
**Horizon 4 — d'ici 2027-11-02** : bilan complet 12 mois ; décision d'accélérer (stock/Europe/financement) ou de réduire (option 5). *Succès* : contribution après pub ≥ 7 CHF/commande sur cohortes mûres (≡ ROAS ≥ 6,5), rotation de stock prouvée, preuves exigées au §6.

**Par horizon (S20.5)** — responsable unique : le dirigeant, sauf mention ; charge de travail estimée **H**.

| Horizon | Coût direct | Charge | Dépendances | Reportable si… |
|---|---|---|---|---|
| 1 (16/11) | 0-5 k (fiduciaire, e-mails DE) | ≈ 15-25 h dirigeant (76 commandes, promesses, exports) | exports bancaires, accès Shopify/Ads | stock pilote, UGC, Europe |
| 2 (02/01) | ≤ 3 k + pub plafonnée | ≈ 5-8 h/semaine (BFCM, SAV proactif, tableau hebdo) | horizon 1 terminé, délais tenus | pilote stock si délai médian > 10 j |
| 3 (02/07) | 4-8 k selon étages ouverts | ≈ 5 h/semaine + fiduciaire | revues précédentes, avis fiscal/juridique | Europe, Sàrl |
| 4 (02/11) | selon revue | bilan 2-3 jours | 12 mois de relevés | toute accélération non prouvée |

## 6. Preuves exigées avant d'accélérer (réponse à la question finale)
1. 8 semaines consécutives de contribution après pub ≥ 7 CHF/commande (≡ ROAS global ≥ 6,5, soit CAC ≤ 33,5 ; point mort 5,4 + marge de sécurité) **sur cohortes mûres (≥ 60 jours) et coûts rapprochés** (≤ 5 % de coûts estimés).
2. Délai médian commande→expédition ≤ 7 jours sur 8 semaines, promesse affichée respectée ≥ 80 %.
3. Remboursements ≤ 7 % du brut, litiges perdus ≤ 0,5 % du CA.
4. Relevés bancaires + décomptes TDFN confirmant 2,1 % et les paiements Galaxus/NER.
5. Séparation comptable Galaxus/Shopify et rémunération versée.
6. ROAS global ≥ 6,5 (point mort 5,4 + marge) sur 4 semaines avant toute hausse de budget ; marginal mesuré par test d'incrémentalité (budget réduit/rétabli).

## 7. Registre garder / réparer / tester / développer / reporter / arrêter
| Élément | Décision | Motif | Preuve |
|---|---|---|---|
| Nom Resell Lausanne, domaine .ch | **Garder** | actifs (avis, liens), problème = économie | bm_02/03 |
| Achat StockX à la commande (88 % du CA) | **Garder + réparer** | contribution 40 CHF/cmd mais délais | fin_00 |
| Délais/promesse livraison | **Réparer** | 25 %/4 % dans la fourchette annoncée | cx_01 |
| Commandes bloquées (97) | **Réparer** | litiges, risque réputationnel | cx_02 |
| Pub Google PMax (marginal) | **Réparer** (−30-35 %) | coût marginal > contribution | ads_01-04, fin_00 §4 |
| tROAS (15 changements/23 j) | **Arrêter** (geler 28 j) | bruit, non mesurable | ads_01 |
| UGG PMax | **Arrêter** (pause) | ≈ 220 CHF/conversion | ads_01 |
| Brand search | **Tester** (mesure incrémentale) | 4,3 % du coût | ads_01 |
| Valeur de conversion Google (brute) | **Réparer** (valeur nette) | 7,1 % remboursés non remontés | ads_02 |
| Ventes sous coût (soldes) | **Réparer/arrêter** | 102/125 sous coût | ads_03 |
| Stock propre/Essentials | **Garder + prouver** | coûts déclarés, 211 lignes à 0 | fin_00 §1 |
| Stock pilote ciblé | **Tester** | délai/annulations | fin_01 §3 |
| Soldes = retours revendus | **Garder + suivre unité par unité** | `LocalStockLot` 36 lots | fin_00 §1 |
| Galaxus | **Garder + protéger/séparer** | contribution ≈ 13-15 k/mois (I/D/H) | fin_01 §2 |
| NER (10 % de marge, CA à un ami) | **Qualifier avec la fiduciaire avant de garder** (qui facture, encaisse, déclare la TVA, assume retours/litiges ; exposition potentielle sur 196 k de CA) | risque fiscal/contractuel | fin_01 §1-2 |
| E-mails en allemand, flux de retard | **Développer** | 41 % de sessions DE, 75 % mails EN | cx_02 |
| Base e-mail (1 016 abonnés réels) | **Réparer** (consentement) | envois à 7 063 non abonnés | cx_04 |
| Crédit magasin comme remboursement par défaut (84 % des seuls retours ; 23 % de la valeur remboursée) | **Tester** (alternative) | confiance, litiges | cx_02 |
| Avis (4,9 ★ « 589+ ») | **Réparer** (affichage vérifiable) | 410 Judge.me ≈ 4,66 | cx_03/bm_03 |
| Politique de retour (URL 404) | **Réparer** | schéma produit | bm_03 |
| UGC/Meta/TikTok | **Reporter** | conditions non remplies | bm_04 |
| Changement de nom | **Arrêter** (pour l'instant) | aucun bénéfice démontré | bm_02 |
| Europe large | **Reporter** (pilote DE+AT seulement) | droits 16,9 % | bm_05 |
| Levée de fonds / dette | **Reporter** | besoin non démontré | fin_01 §5 |
| Modèle d'achat sur commande sans lien de retour | **Réparer** (négocier retours/politique) | cause de la faillite SneakerHype | bm_01 |

## 8. Les 5 décisions immédiates (14 jours)
| # | Décision | Possible maintenant ? | Preuve manquante | Risque si différé | Ce qui l'invaliderait |
|---|---|---|---|---|---|
| 1 | **Traiter nominalement les commandes bloquées** (76 prioritaires sur 93 payées non expédiées ≥ 14 j ; `commandes_prioritaires_14j_180j.csv`) : expédier, rembourser ou prévenir | Oui (action du dirigeant, hors audit) | État réel de chaque commande (certaines expédiées hors Shopify ; 64 sur 76 avec un achat fournisseur lié) | Litiges « produit non reçu » (8 déjà), avis négatifs avant BFCM, remboursements forcés | Si la commande est déjà livrée ou remboursée hors Shopify : simple régularisation |
| 2 | **Plafonner la pub** : geler les tROAS 28 jours, PMax −30-35 % (≈ −4,9 k/mois), pause UGG ; mesurer | Oui | Aucune preuve d'incrémentalité ; effet net estimé **indiscernable du bruit** (≈ 0 à +2 k/mois ; coût marginal 42-75 vs contribution 40,3) : la valeur est le test, pas le gain | Perte continue sur les commandes marginales (≈ 2-3 k/mois) ; bruit des 15 changements en 23 jours | Si le volume chute > 40 % sans baisse de contribution après pub : rétablir et mesurer par géo/période |
| 3 | **Corriger les promesses** : délai de livraison réel, note d'avis vérifiable, « 20 000 références », URL de la politique de retour ; stopper l'exposition en pub des variantes soldées sous coût | Oui (thème/feed : action du dirigeant) | Valeur de la promesse dans la conversion non testable (A/B ≈ 13 mois de trafic) | Litiges et avis négatifs pendant BFCM ; risque de publicité trompeuse | Si les délais passent ≤ 7 j.o. (le stock pilote ou l'achat immédiat) : réafficher 5-10 j.o. |
| 4 | **Fournir les pièces manquantes** : relevés UBS/cartes 24 mois, décomptes TDFN 2,1 %, paiements Galaxus/NER, factures Poste, justification des 206 lignes sans coût | Oui (dirigeant) | C'est la preuve | Décisions de financement et de rémunération prises sur des hypothèses ; TVA/risque fiscal non vérifié | Aucun |
| 5 | **Mandater une fiduciaire** : confirmer le TDFN, comptabilité 2026, séparation Galaxus/Shopify (et NER), avis sur la structure juridique et la rémunération | Oui | Choix du prestataire, budget (1-3 k CHF) | Risque fiscal (NER redirigés, TVA), impossibilité de financer ou d'accélérer | Si la fiduciaire confirme une comptabilité déjà propre et séparée |

## 9. Tableau de bord hebdomadaire (livrable)
`tableaux/tableau_bord_hebdo.csv` (12 dernières semaines, script `fin_12_tableau_bord_hebdo.py`, lundi→dimanche Europe/Zurich). Indicateurs qui changent les décisions, avec définition et source :
| Indicateur | Définition | Source | Seuil d'alerte |
|---|---|---|---|
| Contribution réalisée après pub | net conservé − coût − frais paiement − exp/prépa − pub, par commande créée | `fin_05` (API Shopify + OrderMatch + DailyAdSpend) | < 0 deux semaines de suite |
| Part de coûts estimés | coût estimé / revenu net | `fin_05` | > 10 % (rapprocher) |
| CAC pertinent | pub Google / commandes (global) ; CPA marginal par test d'incrémentalité | DailyAdSpend, Google Ads | > 35 CHF (point mort 40,3 ; cible ≤ 33,5) |
| Remboursements | remboursé / brut | API Shopify | > 10 % |
| Délai de sourcing | médiane commande→expédition ; nombre > 7 jours ; commandes > 14 jours | `ops_01`, `commandes_a_verifier.csv` | médiane > 7 j ; > 0 commande > 14 j |
| Incidents | litiges ouverts/perdus, tickets SAV, mails de retard envoyés | Shopify Payments, boîte SAV (à exporter), Postmark | tout litige « non reçu » |
| Cash libre | solde banque − TVA TDFN due − engagements (achats StockX, pub) | **à renseigner** (aucun relevé) | < 1 mois de charges |
| Engagements | achats StockX payés non livrés, TVA semestrielle, pub du mois | StockX API, DB, AFC | — |
| Réachat | part de commandes de rang ≥ 2 ; délai 1re→2e | `fin_07`, Klaviyo | < 10 % |
| Stock (si pilote) | jours de stock, rotation, prix réalisé vs buy now, coût immobilisé | `LocalStockLot`, Shopify | > 30 jours de stock |
| Galaxus | contribution hebdomadaire, annulations, pénalités, retours, paiements reçus | tables Galaxus + relevés | à définir après mesure (retours Galaxus non mesurables aujourd'hui) |
