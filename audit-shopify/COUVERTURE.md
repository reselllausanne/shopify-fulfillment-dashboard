# COUVERTURE — suivi section par section du brief maître

Source de vérité : `BRIEF_MAITRE.md` (copie exacte de `BRIEF_MAITRE_AUDIT_RESTART_SHOPIFY.md`, 551 lignes).
Statuts : `RÉALISÉ` · `PARTIEL (limite explicite)` · `BLOQUÉ (donnée attendue)` · `NON TRAITÉ (raison)` · `EN COURS` · `PERMANENT`.
Règle : aucune ligne ne se supprime. Une exigence non traitée reste visible avec son statut.
Dernière mise à jour : voir `ETAT.md`.

## Légende des preuves
Chemin relatif sous `audit-shopify/` (analyses/, calculs/, tableaux/) + source (`SOURCES.md`).

---

## S1 — Mission et décision à éclairer
| ID | Exigence | Statut | Preuve / sortie | Blocage |
|---|---|---|---|---|
| 1.1 | Poser le regard dirigeant / DAF / e-commerce / investisseur | RÉALISÉ | RAPPORT_FINAL.md |  |
| 1.2 | Répondre : ce qui marche / détruit marge-cash-réputation-temps | RÉALISÉ | RAPPORT_FINAL.md §1, §4 |  |
| 1.3 | Garder / réparer / simplifier / tester / développer / arrêter | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §7 |  |
| 1.4 | Shopify rentable à notre taille, puis changement d'échelle ? | PARTIEL | RAPPORT_FINAL.md §1 | échelle non prouvée ; banque manquante |
| 1.5 | Repositionnement + modèle ; capital, origine, preuves avant engagement | RÉALISÉ | RAPPORT_FINAL.md §7, analyses/bm_02 |  |
| 1.6 | Plan 2 sem / 2 mois / 8 mois / 1 an | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §8 |  |
| 1.7 | Conclusion défavorable admise ; ne pas défendre anciens diagnostics ni rebranding | RÉALISÉ | RAPPORT_FINAL.md §9 (erratum TDFN ; anciens diagnostics corrigés) |  |

## S2 — Contexte à conserver et à vérifier
Chaque point = contexte dirigeant à vérifier (actualité, période, définition) avant calcul.
| ID | Élément à vérifier | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 2.1 | Identité (Lausanne, marques, Instagram, site) | PARTIEL | analyses/bm_02, analyses/bm_03 | registres de marques non consultés |
| 2.2 | Achat après commande via StockX Express (prix, dispo, remplacement) | RÉALISÉ | analyses/fin_00_base_financiere.md §6-8 | paire rarement achetée avant vente = déclaré |
| 2.3 | Stock propre, retours, collection liquidation ; projet BFCM >300 paires, −50 %, livraison rapide : stock, prix de référence, promesse tenable | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §3 | dossier `bfcm/` non lu ; projet >300 paires/−50 % non audité |
| 2.4 | Galaxus « rentable et subventionne Shopify » | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §2 | cash Galaxus non vérifiable (banque, paiements) |
| 2.5 | Decathlon : flux/ressources partagés seulement | PARTIEL | analyses/fin_01_galaxus_stock_financement.md (tables Decathlon seulement : 421 cmd, 92 k CHF avr-sept) | flux Decathlon non analysés |
| 2.6 | Redémarrage : positionnement, marque, nom, UGC, investissement, stock ciblé, Europe | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §7-8 |  |
| 2.7 | SEO accumulé : objectif à évaluer, non garanti | PARTIEL | analyses/bm_03 | Search Console inaccessible |
| 2.8 | Financement externe / levée : viable aujourd'hui ou par étapes | RÉALISÉ | analyses/fin_01_galaxus_stock_financement.md §5 |  |
| 2.9 | Thème, flux Merchant Center, mesure ; multilingue FR/DE/EN : état actuel | RÉALISÉ | analyses/ads_03, analyses/cx_01 | Simprosys/GTM inaccessibles |
| 2.10 | Structures Google Ads (marques, Core, Explorer, Long Tail) + labels : ce qui existe réellement | RÉALISÉ | analyses/ads_01 |  |
| 2.11 | Dépenses pub élevées, faible récurrence, dispo, trésorerie : mesurer | RÉALISÉ | analyses/fin_00_base_financiere.md §4, analyses/ads_01 |  |
| 2.12 | Email/flows (BFCM en préparation) : inventaire de l'existant | RÉALISÉ | analyses/cx_04 |  |
| 2.13 | Retours avec avoir + frais ; réticence à afficher délai avant paiement : challenger | RÉALISÉ | analyses/cx_02, analyses/cx_03 |  |
| 2.14 | TVA, coût préparation/livraison, commissions paiement : vérifier régime, contrats, coût marginal ; Sàrl non présumée | PARTIEL | analyses/fin_00_base_financiere.md, analyses/fin_01_galaxus_stock_financement.md §1 | TDFN/NER déclarés ; contrats paiement manquants |
| 2.15 | Shopify au centre ; Galaxus = contributeur : mesurer limites et coût d'opportunité | RÉALISÉ | analyses/fin_01_galaxus_stock_financement.md §2 |  |

## S3 — Règles d'exécution et de preuve
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 3.1 | Lecture seule prod ; rien modifié (prix, budgets, campagnes, flux, site, comptes, politiques) ; pas d'achat, pas de contact financeurs/clients | PARTIEL | RAPPORT_FINAL.md §9 | écarts à la lecture seule : jeton StockX copié du VPS, jetons exposés dans des sorties |
| 3.2 | Inventaire accès/exports/scripts/documents | RÉALISÉ | SOURCES.md |  |
| 3.3 | Périodes, dates d'extraction, définitions, limites, ruptures de mesure | PARTIEL | SOURCES.md | ruptures de mesure non toutes documentées |
| 3.4 | Réutiliser données/scripts existants | RÉALISÉ | SOURCES.md |  |
| 3.5 | Données manquantes regroupées (décision bloquée + meilleure approximation) | RÉALISÉ | analyses/donnees_manquantes.md |  |
| 3.6 | Ne jamais prétendre avoir consulté une source inaccessible | PERMANENT (respecté) | RAPPORT_FINAL.md |  |
| 3.7 | Chaque conclusion : fait / interprétation / hypothèse / recommandation / confiance | PERMANENT (appliqué) | RAPPORT_FINAL.md |  |
| 3.8 | Calculs reproductibles Python/SQL ; données dérivées, règles de rapprochement, contrôles | RÉALISÉ | calculs/ |  |
| 3.9 | Montants : devise, période, traitement fiscal, nature (CA, brut, GMV, marge, résultat, encaissement) | PERMANENT (appliqué) |  |  |
| 3.10 | Recherches externes : liens, dates, extraits courts ; sources officielles ; pas de droit/seuil/rendement inventé | PARTIEL | analyses/registre_preuves.md | sources des sous-agents dans leurs fichiers |

## S4 — Base financière et rentabilité réelle
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 4.1 | Rapprochement commandes, lignes, paiements, achats StockX/autres, change, transport, import, livraison, remboursements, avoirs, incidents | PARTIEL | analyses/fin_00_base_financiere.md, analyses/ban_01_tresorerie_reelle.md | revenu/coût/pub rapprochés à la banque ; 14 ordres groupés 98,7 k et octobre manquants |
| 4.2 | Achats remplacés, annulations, multi-colis, remboursements fournisseurs attendus, retours | PARTIEL | analyses/fin_00_base_financiere.md, analyses/cx_02 | multi-colis, achats remplacés, remboursements fournisseurs non mesurés |
| 4.3 | Revenu conservé après remises/annulations/remboursements | RÉALISÉ | analyses/fin_00_base_financiere.md §1 |  |
| 4.4 | Achat complet rendu en Suisse sans double compte | RÉALISÉ | analyses/fin_00_base_financiere.md §2 (coût = enchère + ≈ 28) | TVA/douane d'import non séparées |
| 4.5 | Régime fiscal / TVA effectif | PARTIEL | analyses/fin_00_base_financiere.md, analyses/ban_02_tva_et_liquidites.md | TDFN 2,1 % confirmée (décomptes AFC S1-2025 à S1-2026) ; Galaxus/Decathlon absents du CA S1-2026 à confirmer |
| 4.6 | Frais paiement, rétrofacturations, fraude | PARTIEL | tableaux/fin_01_payments_*.csv | frais hors Shopify Payments estimés |
| 4.7 | Expédition, préparation, emballage, coûts variables | PARTIEL | analyses/fin_00_base_financiere.md | forfaits 6,5 + 8,0, factures Poste manquantes |
| 4.8 | Retours, échanges, incidents, remplacement vendeur, gestes, SAV | PARTIEL | analyses/cx_02 | boîte SAV inaccessible |
| 4.9 | Publicité et autres coûts d'acquisition | RÉALISÉ | analyses/fin_00_base_financiere.md §4, analyses/ads_01 |  |
| 4.10 | Logiciels, salaires, locaux, assurances, fixes, rémunération réaliste du dirigeant | PARTIEL | analyses/ban_01_tresorerie_reelle.md §2.4-2.5 | rémunération observée 5,7-9,1 k/mois ; charges fixes partiellement observées (logiciels 12,5 k, freelances 17,8 k, logistique 35,4 k) |
| 4.11 | 6 niveaux : marge affichée / contribution réalisée avant pub / après acquisition / résultat après fixes / résultat économique / variation de trésorerie + besoins | PARTIEL | analyses/fin_00_base_financiere.md §1, analyses/ban_01_tresorerie_reelle.md §2.4 | variation de trésorerie ≈ +9 k observée ; octobre et soldes à confirmer |
| 4.12 | Coûts propres Shopify, allocation explicite des communs, coût d'autonomie ; pas d'allocation arbitraire | NON TRAITÉ |  | coûts communs Galaxus/Shopify non alloués faute de données |
| 4.13 | Séparer commandes récentes vs cohortes mûres ; pas de marge acquise sans achat/livraison | RÉALISÉ | analyses/fin_00_base_financiere.md §1 (cohortes mûre/récente), tableaux/fin_05_pnl_cohortes.csv (pub répartie au prorata) |  |
| 4.14 | Découpes : marque, famille, taille, tranche prix, sourcing, stock/commande, dispo, canal, nouveau/récurrent, pays | PARTIEL | analyses/fin_00_base_financiere.md §5, tableaux/bm_mix_*.csv, ads_12_*.csv | famille/disponibilité non traitées |
| 4.15 | Échantillon commandes normales/annulées/retournées/échangées/remboursées ; ≥1 exemple complet + exceptions ; couverture + incertitude | RÉALISÉ | analyses/fin_00_base_financiere.md §6 | échanges purs non reconstituables |
| 4.16 | Seuil de rentabilité ; volume pour charges + rémunération ; volume compatible demande/opérations/trésorerie | RÉALISÉ | tableaux/fin_10_seuils.csv |  |
| 4.17 | Soutien réel Galaxus → Shopify | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §2 | cash libre non calculable |

## S5 — Prix, compétitivité, sourcing
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 5.1 | Auditer hypothèses : baisse de prix, formule (buy+14,5+30+15–20)/0,92, ask 160 → ticket 270–285 vs 299, plafond pub 10–12 % / 30–35 CHF, Long Tail réduit, Explorer limité, Core protégé, feed sélectif | PARTIEL | calculs/fin_08_price_formula.py, analyses/ads_04 | Long Tail/Explorer via ads ; benchmark prix non fait |
| 5.2 | Vérifier arithmétique formule + exemple, devises, frais, fiscalité, coûts oubliés ; recalcul avec vrais paramètres | RÉALISÉ | analyses/fin_00_base_financiere.md §5 (Prix), calculs/fin_08_price_formula.py |  |
| 5.3 | Benchmark compétitivité (réf. exacte, coloris, taille, état, service, dispo, délai, livraison, taxes, prix final) ; pas de GTIN/SKU mal rapprochés | NON TRAITÉ |  | aucun rapprochement GTIN/SKU concurrents ni scraping |
| 5.4 | Si baisse de prix : contribution perdue, hausse de commandes requise, coûts sourcing/SAV/financement, plausibilité, test + limite de perte | RÉALISÉ | tableaux/fin_08_volume_requis_baisse_prix.csv | plausibilité de la demande non testée |
| 5.5 | Frais sourcing, ask vs achat, achats impossibles, remplacements, regroupements, change, délais, remboursements fournisseurs | PARTIEL | analyses/fin_00_base_financiere.md §2, analyses/fin_01_galaxus_stock_financement.md §6 | remplacements/regroupements non mesurés |
| 5.6 | Comparer : achat à la commande / fournisseurs alternatifs / réseau revendeurs / stock propre ciblé / hybride (prix, dispo, délai, marge, authenticité, garanties, qualité, capital) | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §6 | prix concurrents, réseau revendeurs, dépôt-vente non traités |

## S6 — Stock et leviers Galaxus
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 6.1 | Deux mécanismes séparés : cash libre Galaxus → Shopify ; synergies achats/stock/fournisseurs/logistique (sans présumer recoupement) | RÉALISÉ | analyses/fin_01_galaxus_stock_financement.md §2 |  |
| 6.2 | Stock marque : modèles/tailles où achat avant commande se justifie ; prix rendu, économies, dispo, délai, effet commercial | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §3 | tailles par modèle non détaillées |
| 6.3 | Règles de sélection, quantités initiales, couverture, réassort | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §3 |  |
| 6.4 | Rotation, sell-through, vieillissement, invendus, démarque, saisonnalité, liquidation | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §3 | rotation historique du stock propre non mesurée |
| 6.5 | Rendement sur capital, délai retour cash, scénario défavorable | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §3 | rotation hypothétique |
| 6.6 | Dépôt-vente, stock partenaire, délais, achats groupés | NON TRAITÉ |  | aucune donnée de dépôt-vente/stock partenaire |
| 6.7 | Distinguer retours/liquidation, stock courant, stock de campagne | PARTIEL | analyses/fin_00_base_financiere.md §1 | 36 lots seulement |
| 6.8 | Galaxus : résultat, cash libre réel, réserves, dettes, taxes, BFR propre | PARTIEL | analyses/ban_01_tresorerie_reelle.md §2.7 | 377,3 k encaissés, ≈ 126 k en attente (H) ; réserves, pénalités, avoirs inconnus |
| 6.9 | Coût pour Galaxus (continuité, croissance) ; comparer financer Shopify / réinvestir Galaxus / réserve | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §2, §5 |  |
| 6.10 | Enveloppe, durée, conditions d'arrêt, suivi séparé ; transfert interne = financement, pas revenu | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §3, §5 | enveloppe indicative |
| 6.11 | Pilote de stock : budget, critères de réussite, sortie ; aucun achat pendant l'audit | RÉALISÉ | analyses/fin_01_galaxus_stock_financement.md §3 | aucun achat effectué |

## S7 — Google Ads, Merchant Center, feed, tracking
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 7.1 | Structure actuelle, fragmentation, volumes, chevauchements | RÉALISÉ | analyses/ads_01 |  |
| 7.2 | Rôle marques/Core/Explorer/Long Tail | RÉALISÉ | analyses/ads_01 |  |
| 7.3 | Budgets, enchères, ROAS cibles, limites, historique des changements | RÉALISÉ | analyses/ads_01 |  |
| 7.4 | Conversions primaires, doublons, valeurs, délais, attribution, consentement, ruptures de tracking | PARTIEL | analyses/ads_02 | GA4/GTM/consentement inaccessibles |
| 7.5 | Annulations / remboursements / non exécutables | RÉALISÉ | analyses/ads_02 |  |
| 7.6 | Marque, nouveaux clients, récurrents, ventes acquises autrement | PARTIEL | analyses/ads_01, analyses/ads_02 | jointure gclid↔commande impossible |
| 7.7 | Coût/perf par produit, segment, taille, compétitivité | PARTIEL | tableaux/ads_12_*.csv |  |
| 7.8 | Feed : titres, GTIN, variantes, tailles, images, langue, LP, refus, fraîcheur | RÉALISÉ | analyses/ads_03 | diagnostics par offre indisponibles |
| 7.9 | Synchro coût/prix/dispo ; risque offre non achetable | RÉALISÉ | analyses/ads_03 |  |
| 7.10 | Distribution des dépenses/exposition : gagnants concentrés, jamais testés, testés sans succès | RÉALISÉ | tableaux/ads_12_*.csv |  |
| 7.11 | Évaluer changements : regroupement/séparation, segmentation, règles Core/Explorer, exclusions/nettoyage, enchères différenciées, tests Shopping/PMax/Search/marque/LP, réallocation, valeurs de conversion | RÉALISÉ | analyses/ads_04 |  |
| 7.12 | Ne pas protéger/supprimer Explorer par principe ; pas de règle arbitraire = vérité | PERMANENT (respecté) | analyses/ads_04 |  |
| 7.13 | Par changement important : état actuel, cible, problème, mécanisme, effet, prérequis, coût, budget, durée, mesure, arrêt, retour arrière | PARTIEL | analyses/ads_04 |  |
| 7.14 | Plafonds CAC/CPA et ROAS dérivés de la contribution ; distinguer CAC payé/global/coût par commande/résultat marginal ; pas de LTV inventée | RÉALISÉ | analyses/ads_04, analyses/fin_00_base_financiere.md §4 |  |
| 7.15 | ROAS seul ≠ rentabilité ; limites d'attribution ; changements simultanés | RÉALISÉ | analyses/ads_02, analyses/ads_04 |  |

## S8 — Site, conversion, parcours client
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 8.1 | Mobile + desktop : découverte, recherche, collections, catalogue, filtres taille, fiche, dispo, taille, panier, paiement, après-achat | PARTIEL | analyses/cx_01 | mobile réel, panier/paiement non testés en achat |
| 8.2 | Vitesse, erreurs, navigation, retour position liste, compréhension offre, confiance, cohérence prix/promesses | PARTIEL | analyses/cx_01 | PageSpeed 429 |
| 8.3 | Qualité économique des commandes (conversion, sourcing réussi, livraison, annulations, SAV, retours, avis, réachat) | RÉALISÉ | analyses/cx_01 |  |
| 8.4 | Convictions challengées (affichage des délais) ; tests mesurant le résultat total | RÉALISÉ | analyses/cx_01 (A/B infaisable ≈ 13 mois) |  |
| 8.5 | Quelques changements priorisés (problème, actuel, proposition, coût, délai, mesure, résultat) ; maquettes seulement si utiles | RÉALISÉ | analyses/cx_01 |  |

## S9 — Emails transactionnels, SAV, politiques, réputation
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 9.1 | Échantillon représentatif d'échanges réels (périodes, langues, statuts, motifs) + fréquences chiffrées | PARTIEL | analyses/cx_02 | boîte SAV inaccessible |
| 9.2 | Audit étapes : confirmation, sourcing, achat impossible, recherche vendeur, retard, expédition, réception, retour, échange, annulation, remboursement, avoir, avis | RÉALISÉ | analyses/cx_02 |  |
| 9.3 | Par étape : promesse, déclencheur/délai, silences, ton, délai de résolution, dépendance dirigeant | RÉALISÉ | analyses/cx_02 |  |
| 9.4 | Textes prioritaires : déclencheur, problème, texte, données, responsable, escalade, mesure, effet ; parcours anormal | PARTIEL | analyses/cx_02 |  |
| 9.5 | Mauvaise communication vs défaillance opérationnelle | RÉALISÉ | analyses/cx_02 |  |
| 9.6 | Motifs de contact, contacts/commande, délais, réouvertures, plaintes, remboursements, coût SAV ; prévention/automatisation/escalade/seuils/délégation | PARTIEL | analyses/cx_02 | contacts/commande non mesurables |
| 9.7 | Politiques retour/échange/annulation/remboursement/avoir vs règles actuelles pays concernés ; coût, conversion, confiance, litige | PARTIEL | analyses/cx_03 | droits nationaux DE/AT/FR/IT/ES/NL non lus ; directive UE non lue |
| 9.8 | Avis publics (Google, Trustpilot si accessibles) ; thèmes, périodes, lien aux données internes ; témoignage vs fréquence | PARTIEL | analyses/cx_03 | Trustpilot/Google inaccessibles |
| 9.9 | Plan de réparation réputation + collecte d'avis honnête ; continuité SAV/légal en cas de changement de nom | PARTIEL | analyses/cx_03, analyses/bm_02 |  |

## S10 — Email marketing, fidélisation, demande
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 10.1 | Inventaire actif/préparé (BFCM) ; ne pas présumer « aucun mailing » | RÉALISÉ | analyses/cx_04 |  |
| 10.2 | Base utilisable, consentements, désabonnements, délivrabilité, profils, tailles, segmentation | RÉALISÉ | analyses/cx_04 |  |
| 10.3 | Flows/campagnes : abandon, bienvenue, après-achat, avis, réachat, réactivation, VIP, retour en stock, liquidation, saisonniers ; justification par les données | RÉALISÉ | analyses/cx_04 |  |
| 10.4 | Service vs marketing ; exclusions désabonnés/litiges ; segmentation taille fiable ; anti-doublon/fatigue ; mesure revenu conservé/contribution/incrémental | PARTIEL | analyses/cx_04 |  |
| 10.5 | Cohortes de réachat, panier, délai, marge, coût fidélisation ; CA plateforme ≠ bénéfice | RÉALISÉ | analyses/cx_04, tableaux/fin_07_cohortes_reachat_2026.csv |  |
| 10.6 | Réseaux sociaux, contenus, communauté, partenariats, affiliation, nouveaux canaux payants ; hiérarchiser | PARTIEL | analyses/bm_04 |  |

## S11 — SEO, GEO, présence en ligne
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 11.1 | Visibilité actuelle/historique, Search Console, indexation, architecture, catégories, variantes, filtres, langues, duplication, contenu, maillage, données structurées, perf, cohérence infos publiques | PARTIEL | analyses/bm_03 | Search Console inaccessible |
| 11.2 | Effets des changements de thème/URL/mesure ; technique vs demande vs concurrence vs tracking | PARTIEL | analyses/bm_03 |  |
| 11.3 | Visibilité IA/GEO : documenté vs reproductible vs hypothèse | PARTIEL | analyses/bm_03 | GEO non reproductible |
| 11.4 | Chaque chantier relié à demande, page, mécanisme, suivi ; pas de croissance gratuite | PARTIEL | analyses/bm_03 |  |
| 11.5 | Comparaison 4 scénarios marque/domaine (marque actuelle repositionnée / nouveau nom même domaine / nouveau domaine migration progressive / autre) | PARTIEL | analyses/bm_02, analyses/bm_03 | registres et redirections manquants |
| 11.6 | Inventaire pages à valeur, mapping URL, redirections, canonicals, langues, schema, Merchant Center, GSC, liens externes, tracking, communication clients ; suivi erreurs, budget transition, baisse possible | PARTIEL | analyses/bm_03 | liste de redirections inaccessible |

## S12 — Entreprises comparables
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 12.1 | Recherche active de 5 à 8 cas solides (sans compléter artificiellement) ; revérifier SneakerAsk, The Sneaker Store, WOOVIN, Sneak City, Limited Resell | RÉALISÉ | analyses/bm_01 |  |
| 12.2 | Typologie : achat StockX pour site / vente sur StockX / marketplace tiers / retailer à stock / accès direct marques | RÉALISÉ | analyses/bm_01 |  |
| 12.3 | Par cas : modèle, pays, canaux, sourcing, stock, proximité ; étapes datées ; CA/GMV/commandes/résultat + définitions ; financement/équipe/capital/rémunération ; leviers ; déclarations ; difficultés/échecs ; transférable vs non | PARTIEL | analyses/bm_01 | comptes publiés partiels |
| 12.4 | Sources : comptes publiés, officiels, entretiens ; audité vs déclaré vs prestataire ; période/situation récente | PARTIEL | analyses/bm_01 |  |
| 12.5 | Contre-exemples (biais du survivant) | RÉALISÉ | analyses/bm_01 (SneakerHype, Restocks, Limited Resell) |  |

## S13 — Repositionnement et relance de marque
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 13.1 | Clientèle d'abord : qui, usage, panier, fréquence ; pourquoi nous ; promesse tenable ; catégories/tailles/service ; avantage résistant au prix | RÉALISÉ | analyses/bm_02, analyses/strat_01_offre_organisation_feuille_de_route.md §2 |  |
| 13.2 | Options 1–5 (améliorer / marque distinctive + stock ciblé / hybride-réseau / Europe / réduire-pivoter) ; combinables/séquençables | RÉALISÉ | analyses/bm_02 |  |
| 13.3 | Par option : cible, promesse, offre, sourcing, service, modèle éco, acquisition, équipe, capital, risques, délai validation, critères d'abandon | PARTIEL | analyses/bm_02 |  |
| 13.4 | Changement de nom : problème résolu, langues/marchés, disponibilité marques/domaines/réseaux, coûts, valeur conservée/perdue, budget, test avant refonte | PARTIEL | analyses/bm_02 | registres de marques non consultés |
| 13.5 | Brief de marque seulement après analyse des options | RÉALISÉ | analyses/bm_02 (brief non produit : option 1 retenue) |  |

## S14 — UGC, contenu, lancement
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 14.1 | Contenu clients / créateurs rémunérés / partenariats / interne ; pas de pub jouée présentée en témoignage | PARTIEL | analyses/bm_04 | tarifs prestataires à confirmer par devis |
| 14.2 | Hypothèses créatives, sélection créateurs, coûts, droits, langues, réutilisation, déclinaisons, tests, conditions pour ouvrir Meta | RÉALISÉ | analyses/bm_04 |  |
| 14.3 | Lancement par étapes ; coût total (création, honoraires, produits, média, temps) | RÉALISÉ | analyses/bm_04 |  |

## S15 — Expansion européenne
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 15.1 | Comparer quelques pays : demande, concurrence, prix livrés, CAC, langue, paiement, confiance, SAV, appro, logistique, retours, fiscalité/douane/TVA (sources actuelles), structure locale, coûts, devises, financement | PARTIEL | analyses/bm_05 | droits/TVA : sources tierces ; fiscalistes non consultés |
| 15.2 | Expédier depuis la Suisse vs stock/partenaire UE vs autres ; pas de double compte taxes/frais | PARTIEL | analyses/bm_05 | origine des colis StockX inconnue |
| 15.3 | Ordre d'entrée, pilote (P&L, budget, critères, capacité) ; prérequis Suisse vs test parallèle | RÉALISÉ | analyses/bm_05 |  |

## S16 — Organisation et décisions du dirigeant
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 16.1 | Cartographie dépendances dirigeant ; temps ; tâches répétitives ; contrôles manquants ; décisions bloquées ; compétences ; capacité | PARTIEL | analyses/strat_01_offre_organisation_feuille_de_route.md §3 | aucune donnée de temps |
| 16.2 | Simplifier / automatiser / déléguer / externaliser / embaucher : coût complet | PARTIEL | analyses/strat_01_offre_organisation_feuille_de_route.md §3 |  |
| 16.3 | Cohérence recrutement, locaux, dev, stock ; responsables et rituels sans équipe inventée | PARTIEL | analyses/strat_01_offre_organisation_feuille_de_route.md §3 |  |
| 16.4 | Revue des choix (volume, dispersion, pricing, dépenses, contrôle, promesses, recrutement, capital) : décision, conséquence, correction, règle ; erreur / arbitrage raisonnable / devenu inadapté | PARTIEL | analyses/strat_01_offre_organisation_feuille_de_route.md §3, RAPPORT_FINAL.md §4 | revue décision par décision non exhaustive |
| 16.5 | Allocation temps/capital vs contraintes réelles | PARTIEL | analyses/strat_01_offre_organisation_feuille_de_route.md §4 |  |

## S17 — Trésorerie, financement croissance, scénarios
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 17.1 | Vision rapprochée du cash + simulation mensuelle 12 mois | PARTIEL | tableaux/modele_tresorerie.xlsx | ouverture = 0 (banque absente) ; formules sans valeurs en cache |
| 17.2 | Distinguer banque / résultat / stocks / créances / dettes / avoirs / remboursements / taxes / engagements | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §4 | banque manquante |
| 17.3 | Calendriers réels achats, cartes, remboursements, Google Ads, payouts Shopify/marketplaces (conditions actuelles) | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §4 | calendriers réels manquants |
| 17.4 | BFR en croissance | RÉALISÉ | analyses/fin_01_galaxus_stock_financement.md §4 |  |
| 17.5 | Plan hebdo 13 semaines | RÉALISÉ | tableaux/modele_tresorerie.xlsx (Sem_13) |  |
| 17.6 | Scénarios prudent/central/favorable 12 mois, hypothèses modifiables liées aux données | RÉALISÉ | tableaux/modele_tresorerie.xlsx, tableaux/fin_10_scenarios.csv |  |
| 17.7 | Seuil de rentabilité, rémunération, point bas, besoin max de capital, réserve, marge de sécurité | RÉALISÉ | tableaux/fin_10_seuils.csv, fin_10_scenarios.csv |  |
| 17.8 | Sensibilités : conversion, panier, CAC, coût achat, annulations, retours, rotation, délais d'encaissement | PARTIEL | tableaux/fin_06_sensibilites.csv, fin_10_stress.csv | conversion/panier non isolés |
| 17.9 | Stress tests : acquisition faible, stock lent, retard payout, sourcing dégradé, ralentissement Galaxus | PARTIEL | tableaux/fin_10_stress.csv | stock lent et ralentissement Galaxus non simulés |
| 17.10 | Séparer transformation / pertes transitoires / stock / BFR / dette / réserve ; pas de levée dans le scénario de base | RÉALISÉ | analyses/fin_01_galaxus_stock_financement.md §4 |  |
| 17.11 | Dépendances fournisseurs/plateformes/canaux/dirigeant ; limites d'engagement, montant max finançable par Galaxus, règles de suspension | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §2, §5 | montant max finançable par Galaxus non calculable |

## S18 — Options de financement, levée
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 18.1 | Finançable aujourd'hui / après jalons / pas de dossier crédible | RÉALISÉ | analyses/fin_01_galaxus_stock_financement.md §5 |  |
| 18.2 | Comparer : autofinancement/cash Galaxus ; BFR/rotation/délais/dépôt-vente ; apport/prêts associés ; crédit/ligne/financement stock-créances ; financement CA ; stratégique/BA/fonds/convertible ; programmes-garanties publics ; croissance lente | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §5 | offres non consultées |
| 18.3 | Par option : entité, conditions, montant/usage/timing, coût complet, remboursement, garanties, risque personnel, dilution/contrôle/sortie, effet cash/résultat, refus possibles, étapes | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §5 |  |
| 18.4 | Structure juridique actuelle (Sàrl non présumée) + entrée au capital ; validation professionnelle | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §5 | avis juridique requis |
| 18.5 | Levée : pourquoi un investisseur, rendement vs capital/risque, rémunération du capital, dilution (sans valorisation inventée), preuves/jalons, risque de mélange Galaxus/Shopify, faisabilité actuelle / après jalons / défavorable | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §5 | aucune valorisation inventée |

## S19 — Preuves, tests, règles d'investissement
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 19.1 | Par levier : problème, preuve+limites, mécanisme, changement, gain (fourchette calculée), coût/délai/dépendances/cash, test+mesure, poursuite/correction/arrêt | PARTIEL | analyses/strat_01_offre_organisation_feuille_de_route.md §4, RAPPORT_FINAL.md | gains en fourchette seulement pour la pub et le modèle |
| 19.2 | Pas d'addition naïve des gains (conversion + CAC + réachat) | PERMANENT (respecté) | analyses/ads_04 |  |
| 19.3 | Volumes, délais de conversion, saisonnalité, BFCM ; liquidation ≠ catalogue courant | PARTIEL | analyses/fin_01_galaxus_stock_financement.md §4 | BFCM modélisé par hypothèse |
| 19.4 | Si test statistique impraticable : ce que le pilote montre / ne montre pas | RÉALISÉ | analyses/cx_01, analyses/ads_04 |  |
| 19.5 | Évaluer en contribution totale + cash | RÉALISÉ | analyses/fin_00_base_financiere.md |  |
| 19.6 | Étapes d'investissement : montant, objectif, preuve, date de revue, capital supplémentaire autorisable ; seuils issus du diagnostic | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §4 (enveloppe, perte max, dates de revue, capital autorisable) |  |

## S20 — Trajectoire 2 sem / 2 mois / 8 mois / 1 an
Départ audit = 2026-11-02 (Europe/Zurich). Échéances : ~2026-11-16 · ~2027-01-02 · ~2027-07-02 · ~2027-11-02.
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 20.1 | 2 semaines : diagnostic/trésorerie, contenir pertes, tests décisifs, options et budget max de découverte | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §5 |  |
| 20.2 | 2 mois : contribution matures, sourcing/service/acquisition, choisir/ajuster/abandonner, pilote stock/contenu/financement | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §5 |  |
| 20.3 | 8 mois : acquisition reproductible, service fiable, moins de dépendance, réachat/rendement stock/discipline, rebranding/Europe | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §5 |  |
| 20.4 | 1 an : Shopify finance fonctionnement + croissance ? échelle, équipe, capital ; accélérer/réduire/repositionner/arrêter | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §5 |  |
| 20.5 | Par horizon : actions, responsable, coût, charge, dépendances, indicateurs, critères de passage, reports | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §5 (tableau par horizon) | responsable unique = dirigeant ; charges en heures = H |

## S21 — Livrables (15) + question finale
| # | Livrable | Statut | Fichier |
|---|---|---|---|
| L1 | Verdict Shopify (santé, viabilité, potentiel, confiance) | RÉALISÉ | RAPPORT_FINAL.md §1 |
| L2 | Inventaire sources, qualité, manques, décisions affectées | RÉALISÉ | SOURCES.md, analyses/donnees_manquantes.md |
| L3 | Reconstitution financière + rapprochement commandes/achats/encaissements | PARTIEL | analyses/fin_00_base_financiere.md ; limite : banque manquante |
| L4 | Causes des pertes/problèmes/contraintes classées par impact | PARTIEL | RAPPORT_FINAL.md §4 ; limite : unités hétérogènes ; liens causaux délai→annulation = I |
| L5 | Proposition Ads/Merchant/feed/tracking | RÉALISÉ | RAPPORT_FINAL.md §5, analyses/ads_04 |
| L6 | Corrections site/sourcing/emails/SAV/politiques/réputation | RÉALISÉ | RAPPORT_FINAL.md §6, analyses/cx_01, analyses/cx_02, analyses/cx_03, analyses/cx_04 |
| L7 | Plan croissance (fidélisation, contenu, UGC, SEO/GEO, canaux) | PARTIEL | RAPPORT_FINAL.md §7, analyses/bm_03, analyses/bm_04 |
| L8 | Benchmark documenté + contre-exemples | RÉALISÉ | analyses/bm_01 |
| L9 | Comparaison repositionnements + recommandation + invalidation | RÉALISÉ | analyses/bm_02 |
| L10 | Plan marque/nom/SEO transition/Europe | PARTIEL | analyses/bm_02, analyses/bm_03, analyses/bm_05 ; limite : registres de marques, redirections |
| L11 | Politique stock + synergies Galaxus + protection cash | RÉALISÉ | analyses/fin_01_galaxus_stock_financement.md |
| L12 | Besoin capital, options, verdict levée (aujourd'hui / jalons) | RÉALISÉ | analyses/fin_01_galaxus_stock_financement.md §5 |
| L13 | Prévisionnels, trésorerie 13 sem, scénarios 12 mois modifiables | RÉALISÉ | tableaux/modele_tresorerie.xlsx, fin_10_redressement_decomposition.csv ; limite : ouverture = 0 |
| L14 | Organisation cible, revue décisions, 4 horizons | PARTIEL | analyses/strat_01_offre_organisation_feuille_de_route.md |
| L15 | Registre garder/réparer/tester/développer/reporter/arrêter + tableau hebdo (indicateurs définis + source) + 5 décisions immédiates (possible maintenant ? preuve manquante ? risque de différer ? invalidation) | RÉALISÉ | analyses/strat_01_offre_organisation_feuille_de_route.md §7-9, tableaux/tableau_bord_hebdo.csv |
| LF | Réponse à la question finale (offre/marque, où investir argent+temps, place Galaxus/stock, financement, preuves avant accélération) | RÉALISÉ | RAPPORT_FINAL.md §10 |

## S22 — Organisation du travail
| ID | Exigence | Statut | Preuve |
|---|---|---|---|
| 22.1 | Arborescence : BRIEF_MAITRE, COUVERTURE, SOURCES, ETAT, calculs/, tableaux/, analyses/, RAPPORT_FINAL | RÉALISÉ | audit-shopify/ |
| 22.2 | Sources et base financière d'abord ; agrégations puis exemples ; emails échantillonnés ; sources conservées | RÉALISÉ | ETAT.md |
| 22.3 | Sous-agents (max 3 : Ads/feed/tracking ; parcours/SAV/avis/fidélisation ; benchmark/repositionnement/SEO/UGC/Europe), mandat + sources + définitions transmis ; pilote garde finance/cash/financement/stock-Galaxus/synthèse et contrôle les preuves | RÉALISÉ | ETAT.md (3 sous-agents + relecture) |
| 22.4 | Points d'avancement courts ; sauvegarde avant limite de contexte ; à la reprise lire ETAT, SOURCES, COUVERTURE | PERMANENT (appliqué) | ETAT.md |
| 22.5 | Vérification finale section par section (réalisé / partiel + limite / bloqué + donnée) | RÉALISÉ | COUVERTURE.md, section « Vérification finale » |
| 22.6 | Relecture indépendante finale (calculs, doubles comptes, attribution, preuves faibles, scénarios irréalistes, omissions) | RÉALISÉ | analyses/relecture_independante.md (agent a1e1f171) ; corrections C1-C13 appliquées ou documentées |

## Vérification finale (S22.5)
Dernière vérification : 2026-11-03 00:30 (Europe/Zurich), après relecture indépendante (`analyses/relecture_independante.md`).
Total 177 exigences : RÉALISÉ 88 · PARTIEL 80 · NON TRAITÉ 3 · BLOQUÉ 0 · PERMANENT 6.

**NON TRAITÉ (limite)** : 4.12, 5.3, 6.6. 5.3 benchmark de prix concurrents par référence exacte (aucun rapprochement GTIN/SKU ni scraping réalisé) ; 6.6 dépôt-vente/stock partenaire (aucune donnée) ; 4.12 allocation des coûts communs (données absentes).
**BLOQUÉ (donnée exacte attendue)** : . 6.8 cash libre Galaxus : relevés bancaires UBS 24 mois, paiements/avoirs/pénalités Galaxus, convention NER.
**PARTIEL (limite explicite dans la colonne Blocage)** : 1.4, 2.1, 2.3, 2.4, 2.5, 2.7, 2.14, 3.1, 3.3, 3.10, 4.1, 4.2, 4.5, 4.6, 4.7, 4.8, 4.10, 4.11, 4.14, 4.17, 5.1, 5.5, 5.6, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 6.9, 6.10, 7.4, 7.6, 7.7, 7.13, 8.1, 8.2, 9.1, 9.4, 9.6, 9.7, 9.8, 9.9, 10.4, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.3, 12.4, 13.3, 13.4, 14.1, 15.1, 15.2, 16.1, 16.2, 16.3, 16.4, 16.5, 17.1, 17.2, 17.3, 17.8, 17.9, 17.11, 18.2, 18.3, 18.4, 18.5, 19.1, 19.3, L3, L4, L7, L10, L14.
Les données réellement manquantes sont regroupées et classées par décision bloquée dans `analyses/donnees_manquantes.md` (21 lignes).
Cohérence : les chiffres de référence sont ceux de `analyses/fin_00_base_financiere.md` et `RAPPORT_FINAL.md` (TDFN 2,1 %, 40,3 CHF/commande avant pub, ROAS d'équilibre 5,4, résultat avant rémunération ≈ 0 à +12 k non démontré). Les analyses des sous-agents ont été corrigées dans leur corps et portent un bandeau d'erratum.
