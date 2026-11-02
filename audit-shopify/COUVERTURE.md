# COUVERTURE — suivi section par section du brief maître

Source de vérité : `BRIEF_MAITRE.md` (copie exacte de `BRIEF_MAITRE_AUDIT_RESTART_SHOPIFY.md`, 551 lignes).
Statuts : `À FAIRE` · `EN COURS` · `RÉALISÉ` · `PARTIEL (limite explicite)` · `BLOQUÉ (donnée attendue)`.
Règle : aucune ligne ne se supprime. Une exigence non traitée reste visible avec son statut.
Dernière mise à jour : voir `ETAT.md`.

## Légende des preuves
Chemin relatif sous `audit-shopify/` (analyses/, calculs/, tableaux/) + source (`SOURCES.md`).

---

## S1 — Mission et décision à éclairer
| ID | Exigence | Statut | Preuve / sortie | Blocage |
|---|---|---|---|---|
| 1.1 | Poser le regard dirigeant / DAF / e-commerce / investisseur | À FAIRE | RAPPORT_FINAL | |
| 1.2 | Répondre : ce qui marche / détruit marge-cash-réputation-temps | À FAIRE | RAPPORT_FINAL §verdict | |
| 1.3 | Garder / réparer / simplifier / tester / développer / arrêter | À FAIRE | analyses/registre_decisions.md | |
| 1.4 | Shopify rentable à notre taille, puis changement d'échelle ? | À FAIRE | | |
| 1.5 | Repositionnement + modèle ; capital, origine, preuves avant engagement | À FAIRE | | |
| 1.6 | Plan 2 sem / 2 mois / 8 mois / 1 an | À FAIRE | | |
| 1.7 | Conclusion défavorable admise ; ne pas défendre anciens diagnostics ni rebranding | À FAIRE | | |

## S2 — Contexte à conserver et à vérifier
Chaque point = contexte dirigeant à vérifier (actualité, période, définition) avant calcul.
| ID | Élément à vérifier | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 2.1 | Identité (Lausanne, marques, Instagram, site) | À FAIRE | | |
| 2.2 | Achat après commande via StockX Express (prix, dispo, remplacement) | À FAIRE | | |
| 2.3 | Stock propre, retours, collection liquidation ; projet BFCM >300 paires, −50 %, livraison rapide : stock, prix de référence, promesse tenable | À FAIRE | | |
| 2.4 | Galaxus « rentable et subventionne Shopify » | À FAIRE | | |
| 2.5 | Decathlon : flux/ressources partagés seulement | À FAIRE | | |
| 2.6 | Redémarrage : positionnement, marque, nom, UGC, investissement, stock ciblé, Europe | À FAIRE | | |
| 2.7 | SEO accumulé : objectif à évaluer, non garanti | À FAIRE | | |
| 2.8 | Financement externe / levée : viable aujourd'hui ou par étapes | À FAIRE | | |
| 2.9 | Thème, flux Merchant Center, mesure ; multilingue FR/DE/EN : état actuel | À FAIRE | | |
| 2.10 | Structures Google Ads (marques, Core, Explorer, Long Tail) + labels : ce qui existe réellement | À FAIRE | | |
| 2.11 | Dépenses pub élevées, faible récurrence, dispo, trésorerie : mesurer | À FAIRE | | |
| 2.12 | Email/flows (BFCM en préparation) : inventaire de l'existant | À FAIRE | | |
| 2.13 | Retours avec avoir + frais ; réticence à afficher délai avant paiement : challenger | À FAIRE | | |
| 2.14 | TVA, coût préparation/livraison, commissions paiement : vérifier régime, contrats, coût marginal ; Sàrl non présumée | À FAIRE | | |
| 2.15 | Shopify au centre ; Galaxus = contributeur : mesurer limites et coût d'opportunité | À FAIRE | | |

## S3 — Règles d'exécution et de preuve
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 3.1 | Lecture seule prod ; rien modifié (prix, budgets, campagnes, flux, site, comptes, politiques) ; pas d'achat, pas de contact financeurs/clients | EN COURS | ETAT.md journal des accès | |
| 3.2 | Inventaire accès/exports/scripts/documents | EN COURS | SOURCES.md | |
| 3.3 | Périodes, dates d'extraction, définitions, limites, ruptures de mesure | À FAIRE | SOURCES.md | |
| 3.4 | Réutiliser données/scripts existants | EN COURS | SOURCES.md | |
| 3.5 | Données manquantes regroupées (décision bloquée + meilleure approximation) | À FAIRE | analyses/donnees_manquantes.md | |
| 3.6 | Ne jamais prétendre avoir consulté une source inaccessible | PERMANENT | | |
| 3.7 | Chaque conclusion : fait / interprétation / hypothèse / recommandation / confiance | PERMANENT | gabarit dans RAPPORT_FINAL | |
| 3.8 | Calculs reproductibles Python/SQL ; données dérivées, règles de rapprochement, contrôles | EN COURS | calculs/, tableaux/ | |
| 3.9 | Montants : devise, période, traitement fiscal, nature (CA, brut, GMV, marge, résultat, encaissement) | PERMANENT | | |
| 3.10 | Recherches externes : liens, dates, extraits courts ; sources officielles ; pas de droit/seuil/rendement inventé | À FAIRE | analyses/registre_preuves.md | |

## S4 — Base financière et rentabilité réelle
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 4.1 | Rapprochement commandes, lignes, paiements, achats StockX/autres, change, transport, import, livraison, remboursements, avoirs, incidents | EN COURS | calculs/ | |
| 4.2 | Achats remplacés, annulations, multi-colis, remboursements fournisseurs attendus, retours | À FAIRE | | |
| 4.3 | Revenu conservé après remises/annulations/remboursements | À FAIRE | | |
| 4.4 | Achat complet rendu en Suisse sans double compte | À FAIRE | | |
| 4.5 | Régime fiscal / TVA effectif | À FAIRE | | |
| 4.6 | Frais paiement, rétrofacturations, fraude | À FAIRE | | |
| 4.7 | Expédition, préparation, emballage, coûts variables | À FAIRE | | |
| 4.8 | Retours, échanges, incidents, remplacement vendeur, gestes, SAV | À FAIRE | | |
| 4.9 | Publicité et autres coûts d'acquisition | À FAIRE | | |
| 4.10 | Logiciels, salaires, locaux, assurances, fixes, rémunération réaliste du dirigeant | À FAIRE | | |
| 4.11 | 6 niveaux : marge affichée / contribution réalisée avant pub / après acquisition / résultat après fixes / résultat économique / variation de trésorerie + besoins | À FAIRE | tableaux/ | |
| 4.12 | Coûts propres Shopify, allocation explicite des communs, coût d'autonomie ; pas d'allocation arbitraire | À FAIRE | | |
| 4.13 | Séparer commandes récentes vs cohortes mûres ; pas de marge acquise sans achat/livraison | À FAIRE | | |
| 4.14 | Découpes : marque, famille, taille, tranche prix, sourcing, stock/commande, dispo, canal, nouveau/récurrent, pays | À FAIRE | | |
| 4.15 | Échantillon commandes normales/annulées/retournées/échangées/remboursées ; ≥1 exemple complet + exceptions ; couverture + incertitude | À FAIRE | | |
| 4.16 | Seuil de rentabilité ; volume pour charges + rémunération ; volume compatible demande/opérations/trésorerie | À FAIRE | | |
| 4.17 | Soutien réel Galaxus → Shopify | À FAIRE | | |

## S5 — Prix, compétitivité, sourcing
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 5.1 | Auditer hypothèses : baisse de prix, formule (buy+14,5+30+15–20)/0,92, ask 160 → ticket 270–285 vs 299, plafond pub 10–12 % / 30–35 CHF, Long Tail réduit, Explorer limité, Core protégé, feed sélectif | À FAIRE | | |
| 5.2 | Vérifier arithmétique formule + exemple, devises, frais, fiscalité, coûts oubliés ; recalcul avec vrais paramètres | À FAIRE | calculs/ | |
| 5.3 | Benchmark compétitivité (réf. exacte, coloris, taille, état, service, dispo, délai, livraison, taxes, prix final) ; pas de GTIN/SKU mal rapprochés | À FAIRE | | |
| 5.4 | Si baisse de prix : contribution perdue, hausse de commandes requise, coûts sourcing/SAV/financement, plausibilité, test + limite de perte | À FAIRE | | |
| 5.5 | Frais sourcing, ask vs achat, achats impossibles, remplacements, regroupements, change, délais, remboursements fournisseurs | À FAIRE | | |
| 5.6 | Comparer : achat à la commande / fournisseurs alternatifs / réseau revendeurs / stock propre ciblé / hybride (prix, dispo, délai, marge, authenticité, garanties, qualité, capital) | À FAIRE | | |

## S6 — Stock et leviers Galaxus
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 6.1 | Deux mécanismes séparés : cash libre Galaxus → Shopify ; synergies achats/stock/fournisseurs/logistique (sans présumer recoupement) | À FAIRE | | |
| 6.2 | Stock marque : modèles/tailles où achat avant commande se justifie ; prix rendu, économies, dispo, délai, effet commercial | À FAIRE | | |
| 6.3 | Règles de sélection, quantités initiales, couverture, réassort | À FAIRE | | |
| 6.4 | Rotation, sell-through, vieillissement, invendus, démarque, saisonnalité, liquidation | À FAIRE | | |
| 6.5 | Rendement sur capital, délai retour cash, scénario défavorable | À FAIRE | | |
| 6.6 | Dépôt-vente, stock partenaire, délais, achats groupés | À FAIRE | | |
| 6.7 | Distinguer retours/liquidation, stock courant, stock de campagne | À FAIRE | | |
| 6.8 | Galaxus : résultat, cash libre réel, réserves, dettes, taxes, BFR propre | À FAIRE | | |
| 6.9 | Coût pour Galaxus (continuité, croissance) ; comparer financer Shopify / réinvestir Galaxus / réserve | À FAIRE | | |
| 6.10 | Enveloppe, durée, conditions d'arrêt, suivi séparé ; transfert interne = financement, pas revenu | À FAIRE | | |
| 6.11 | Pilote de stock : budget, critères de réussite, sortie ; aucun achat pendant l'audit | À FAIRE | | |

## S7 — Google Ads, Merchant Center, feed, tracking
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 7.1 | Structure actuelle, fragmentation, volumes, chevauchements | À FAIRE | | |
| 7.2 | Rôle marques/Core/Explorer/Long Tail | À FAIRE | | |
| 7.3 | Budgets, enchères, ROAS cibles, limites, historique des changements | À FAIRE | | |
| 7.4 | Conversions primaires, doublons, valeurs, délais, attribution, consentement, ruptures de tracking | À FAIRE | | |
| 7.5 | Annulations / remboursements / non exécutables | À FAIRE | | |
| 7.6 | Marque, nouveaux clients, récurrents, ventes acquises autrement | À FAIRE | | |
| 7.7 | Coût/perf par produit, segment, taille, compétitivité | À FAIRE | | |
| 7.8 | Feed : titres, GTIN, variantes, tailles, images, langue, LP, refus, fraîcheur | À FAIRE | | |
| 7.9 | Synchro coût/prix/dispo ; risque offre non achetable | À FAIRE | | |
| 7.10 | Distribution des dépenses/exposition : gagnants concentrés, jamais testés, testés sans succès | À FAIRE | | |
| 7.11 | Évaluer changements : regroupement/séparation, segmentation, règles Core/Explorer, exclusions/nettoyage, enchères différenciées, tests Shopping/PMax/Search/marque/LP, réallocation, valeurs de conversion | À FAIRE | | |
| 7.12 | Ne pas protéger/supprimer Explorer par principe ; pas de règle arbitraire = vérité | PERMANENT | | |
| 7.13 | Par changement important : état actuel, cible, problème, mécanisme, effet, prérequis, coût, budget, durée, mesure, arrêt, retour arrière | À FAIRE | | |
| 7.14 | Plafonds CAC/CPA et ROAS dérivés de la contribution ; distinguer CAC payé/global/coût par commande/résultat marginal ; pas de LTV inventée | À FAIRE | | |
| 7.15 | ROAS seul ≠ rentabilité ; limites d'attribution ; changements simultanés | À FAIRE | | |

## S8 — Site, conversion, parcours client
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 8.1 | Mobile + desktop : découverte, recherche, collections, catalogue, filtres taille, fiche, dispo, taille, panier, paiement, après-achat | À FAIRE | | |
| 8.2 | Vitesse, erreurs, navigation, retour position liste, compréhension offre, confiance, cohérence prix/promesses | À FAIRE | | |
| 8.3 | Qualité économique des commandes (conversion, sourcing réussi, livraison, annulations, SAV, retours, avis, réachat) | À FAIRE | | |
| 8.4 | Convictions challengées (affichage des délais) ; tests mesurant le résultat total | À FAIRE | | |
| 8.5 | Quelques changements priorisés (problème, actuel, proposition, coût, délai, mesure, résultat) ; maquettes seulement si utiles | À FAIRE | | |

## S9 — Emails transactionnels, SAV, politiques, réputation
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 9.1 | Échantillon représentatif d'échanges réels (périodes, langues, statuts, motifs) + fréquences chiffrées | À FAIRE | | |
| 9.2 | Audit étapes : confirmation, sourcing, achat impossible, recherche vendeur, retard, expédition, réception, retour, échange, annulation, remboursement, avoir, avis | À FAIRE | | |
| 9.3 | Par étape : promesse, déclencheur/délai, silences, ton, délai de résolution, dépendance dirigeant | À FAIRE | | |
| 9.4 | Textes prioritaires : déclencheur, problème, texte, données, responsable, escalade, mesure, effet ; parcours anormal | À FAIRE | | |
| 9.5 | Mauvaise communication vs défaillance opérationnelle | À FAIRE | | |
| 9.6 | Motifs de contact, contacts/commande, délais, réouvertures, plaintes, remboursements, coût SAV ; prévention/automatisation/escalade/seuils/délégation | À FAIRE | | |
| 9.7 | Politiques retour/échange/annulation/remboursement/avoir vs règles actuelles pays concernés ; coût, conversion, confiance, litige | À FAIRE | | |
| 9.8 | Avis publics (Google, Trustpilot si accessibles) ; thèmes, périodes, lien aux données internes ; témoignage vs fréquence | À FAIRE | | |
| 9.9 | Plan de réparation réputation + collecte d'avis honnête ; continuité SAV/légal en cas de changement de nom | À FAIRE | | |

## S10 — Email marketing, fidélisation, demande
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 10.1 | Inventaire actif/préparé (BFCM) ; ne pas présumer « aucun mailing » | À FAIRE | | |
| 10.2 | Base utilisable, consentements, désabonnements, délivrabilité, profils, tailles, segmentation | À FAIRE | | |
| 10.3 | Flows/campagnes : abandon, bienvenue, après-achat, avis, réachat, réactivation, VIP, retour en stock, liquidation, saisonniers ; justification par les données | À FAIRE | | |
| 10.4 | Service vs marketing ; exclusions désabonnés/litiges ; segmentation taille fiable ; anti-doublon/fatigue ; mesure revenu conservé/contribution/incrémental | À FAIRE | | |
| 10.5 | Cohortes de réachat, panier, délai, marge, coût fidélisation ; CA plateforme ≠ bénéfice | À FAIRE | | |
| 10.6 | Réseaux sociaux, contenus, communauté, partenariats, affiliation, nouveaux canaux payants ; hiérarchiser | À FAIRE | | |

## S11 — SEO, GEO, présence en ligne
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 11.1 | Visibilité actuelle/historique, Search Console, indexation, architecture, catégories, variantes, filtres, langues, duplication, contenu, maillage, données structurées, perf, cohérence infos publiques | À FAIRE | | |
| 11.2 | Effets des changements de thème/URL/mesure ; technique vs demande vs concurrence vs tracking | À FAIRE | | |
| 11.3 | Visibilité IA/GEO : documenté vs reproductible vs hypothèse | À FAIRE | | |
| 11.4 | Chaque chantier relié à demande, page, mécanisme, suivi ; pas de croissance gratuite | À FAIRE | | |
| 11.5 | Comparaison 4 scénarios marque/domaine (marque actuelle repositionnée / nouveau nom même domaine / nouveau domaine migration progressive / autre) | À FAIRE | | |
| 11.6 | Inventaire pages à valeur, mapping URL, redirections, canonicals, langues, schema, Merchant Center, GSC, liens externes, tracking, communication clients ; suivi erreurs, budget transition, baisse possible | À FAIRE | | |

## S12 — Entreprises comparables
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 12.1 | Recherche active de 5 à 8 cas solides (sans compléter artificiellement) ; revérifier SneakerAsk, The Sneaker Store, WOOVIN, Sneak City, Limited Resell | À FAIRE | | |
| 12.2 | Typologie : achat StockX pour site / vente sur StockX / marketplace tiers / retailer à stock / accès direct marques | À FAIRE | | |
| 12.3 | Par cas : modèle, pays, canaux, sourcing, stock, proximité ; étapes datées ; CA/GMV/commandes/résultat + définitions ; financement/équipe/capital/rémunération ; leviers ; déclarations ; difficultés/échecs ; transférable vs non | À FAIRE | | |
| 12.4 | Sources : comptes publiés, officiels, entretiens ; audité vs déclaré vs prestataire ; période/situation récente | À FAIRE | | |
| 12.5 | Contre-exemples (biais du survivant) | À FAIRE | | |

## S13 — Repositionnement et relance de marque
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 13.1 | Clientèle d'abord : qui, usage, panier, fréquence ; pourquoi nous ; promesse tenable ; catégories/tailles/service ; avantage résistant au prix | À FAIRE | | |
| 13.2 | Options 1–5 (améliorer / marque distinctive + stock ciblé / hybride-réseau / Europe / réduire-pivoter) ; combinables/séquençables | À FAIRE | | |
| 13.3 | Par option : cible, promesse, offre, sourcing, service, modèle éco, acquisition, équipe, capital, risques, délai validation, critères d'abandon | À FAIRE | | |
| 13.4 | Changement de nom : problème résolu, langues/marchés, disponibilité marques/domaines/réseaux, coûts, valeur conservée/perdue, budget, test avant refonte | À FAIRE | | |
| 13.5 | Brief de marque seulement après analyse des options | À FAIRE | | |

## S14 — UGC, contenu, lancement
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 14.1 | Contenu clients / créateurs rémunérés / partenariats / interne ; pas de pub jouée présentée en témoignage | À FAIRE | | |
| 14.2 | Hypothèses créatives, sélection créateurs, coûts, droits, langues, réutilisation, déclinaisons, tests, conditions pour ouvrir Meta | À FAIRE | | |
| 14.3 | Lancement par étapes ; coût total (création, honoraires, produits, média, temps) | À FAIRE | | |

## S15 — Expansion européenne
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 15.1 | Comparer quelques pays : demande, concurrence, prix livrés, CAC, langue, paiement, confiance, SAV, appro, logistique, retours, fiscalité/douane/TVA (sources actuelles), structure locale, coûts, devises, financement | À FAIRE | | |
| 15.2 | Expédier depuis la Suisse vs stock/partenaire UE vs autres ; pas de double compte taxes/frais | À FAIRE | | |
| 15.3 | Ordre d'entrée, pilote (P&L, budget, critères, capacité) ; prérequis Suisse vs test parallèle | À FAIRE | | |

## S16 — Organisation et décisions du dirigeant
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 16.1 | Cartographie dépendances dirigeant ; temps ; tâches répétitives ; contrôles manquants ; décisions bloquées ; compétences ; capacité | À FAIRE | | |
| 16.2 | Simplifier / automatiser / déléguer / externaliser / embaucher : coût complet | À FAIRE | | |
| 16.3 | Cohérence recrutement, locaux, dev, stock ; responsables et rituels sans équipe inventée | À FAIRE | | |
| 16.4 | Revue des choix (volume, dispersion, pricing, dépenses, contrôle, promesses, recrutement, capital) : décision, conséquence, correction, règle ; erreur / arbitrage raisonnable / devenu inadapté | À FAIRE | | |
| 16.5 | Allocation temps/capital vs contraintes réelles | À FAIRE | | |

## S17 — Trésorerie, financement croissance, scénarios
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 17.1 | Vision rapprochée du cash + simulation mensuelle 12 mois | À FAIRE | | |
| 17.2 | Distinguer banque / résultat / stocks / créances / dettes / avoirs / remboursements / taxes / engagements | À FAIRE | | |
| 17.3 | Calendriers réels achats, cartes, remboursements, Google Ads, payouts Shopify/marketplaces (conditions actuelles) | À FAIRE | | |
| 17.4 | BFR en croissance | À FAIRE | | |
| 17.5 | Plan hebdo 13 semaines | À FAIRE | tableaux/ | |
| 17.6 | Scénarios prudent/central/favorable 12 mois, hypothèses modifiables liées aux données | À FAIRE | tableaux/ | |
| 17.7 | Seuil de rentabilité, rémunération, point bas, besoin max de capital, réserve, marge de sécurité | À FAIRE | | |
| 17.8 | Sensibilités : conversion, panier, CAC, coût achat, annulations, retours, rotation, délais d'encaissement | À FAIRE | | |
| 17.9 | Stress tests : acquisition faible, stock lent, retard payout, sourcing dégradé, ralentissement Galaxus | À FAIRE | | |
| 17.10 | Séparer transformation / pertes transitoires / stock / BFR / dette / réserve ; pas de levée dans le scénario de base | À FAIRE | | |
| 17.11 | Dépendances fournisseurs/plateformes/canaux/dirigeant ; limites d'engagement, montant max finançable par Galaxus, règles de suspension | À FAIRE | | |

## S18 — Options de financement, levée
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 18.1 | Finançable aujourd'hui / après jalons / pas de dossier crédible | À FAIRE | | |
| 18.2 | Comparer : autofinancement/cash Galaxus ; BFR/rotation/délais/dépôt-vente ; apport/prêts associés ; crédit/ligne/financement stock-créances ; financement CA ; stratégique/BA/fonds/convertible ; programmes-garanties publics ; croissance lente | À FAIRE | | |
| 18.3 | Par option : entité, conditions, montant/usage/timing, coût complet, remboursement, garanties, risque personnel, dilution/contrôle/sortie, effet cash/résultat, refus possibles, étapes | À FAIRE | | |
| 18.4 | Structure juridique actuelle (Sàrl non présumée) + entrée au capital ; validation professionnelle | À FAIRE | | |
| 18.5 | Levée : pourquoi un investisseur, rendement vs capital/risque, rémunération du capital, dilution (sans valorisation inventée), preuves/jalons, risque de mélange Galaxus/Shopify, faisabilité actuelle / après jalons / défavorable | À FAIRE | | |

## S19 — Preuves, tests, règles d'investissement
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 19.1 | Par levier : problème, preuve+limites, mécanisme, changement, gain (fourchette calculée), coût/délai/dépendances/cash, test+mesure, poursuite/correction/arrêt | À FAIRE | | |
| 19.2 | Pas d'addition naïve des gains (conversion + CAC + réachat) | PERMANENT | | |
| 19.3 | Volumes, délais de conversion, saisonnalité, BFCM ; liquidation ≠ catalogue courant | À FAIRE | | |
| 19.4 | Si test statistique impraticable : ce que le pilote montre / ne montre pas | À FAIRE | | |
| 19.5 | Évaluer en contribution totale + cash | À FAIRE | | |
| 19.6 | Étapes d'investissement : montant, objectif, preuve, date de revue, capital supplémentaire autorisable ; seuils issus du diagnostic | À FAIRE | | |

## S20 — Trajectoire 2 sem / 2 mois / 8 mois / 1 an
Départ audit = 2026-11-02 (Europe/Zurich). Échéances : ~2026-11-16 · ~2027-01-02 · ~2027-07-02 · ~2027-11-02.
| ID | Exigence | Statut | Preuve | Blocage |
|---|---|---|---|---|
| 20.1 | 2 semaines : diagnostic/trésorerie, contenir pertes, tests décisifs, options et budget max de découverte | À FAIRE | | |
| 20.2 | 2 mois : contribution matures, sourcing/service/acquisition, choisir/ajuster/abandonner, pilote stock/contenu/financement | À FAIRE | | |
| 20.3 | 8 mois : acquisition reproductible, service fiable, moins de dépendance, réachat/rendement stock/discipline, rebranding/Europe | À FAIRE | | |
| 20.4 | 1 an : Shopify finance fonctionnement + croissance ? échelle, équipe, capital ; accélérer/réduire/repositionner/arrêter | À FAIRE | | |
| 20.5 | Par horizon : actions, responsable, coût, charge, dépendances, indicateurs, critères de passage, reports | À FAIRE | | |

## S21 — Livrables (15) + question finale
| # | Livrable | Statut | Fichier |
|---|---|---|---|
| L1 | Verdict Shopify (santé, viabilité, potentiel, confiance) | À FAIRE | RAPPORT_FINAL.md |
| L2 | Inventaire sources, qualité, manques, décisions affectées | EN COURS | SOURCES.md |
| L3 | Reconstitution financière + rapprochement commandes/achats/encaissements | EN COURS | analyses/ |
| L4 | Causes des pertes/problèmes/contraintes classées par impact | À FAIRE | |
| L5 | Proposition Ads/Merchant/feed/tracking | À FAIRE | |
| L6 | Corrections site/sourcing/emails/SAV/politiques/réputation | À FAIRE | |
| L7 | Plan croissance (fidélisation, contenu, UGC, SEO/GEO, canaux) | À FAIRE | |
| L8 | Benchmark documenté + contre-exemples | À FAIRE | |
| L9 | Comparaison repositionnements + recommandation + invalidation | À FAIRE | |
| L10 | Plan marque/nom/SEO transition/Europe | À FAIRE | |
| L11 | Politique stock + synergies Galaxus + protection cash | À FAIRE | |
| L12 | Besoin capital, options, verdict levée (aujourd'hui / jalons) | À FAIRE | |
| L13 | Prévisionnels, trésorerie 13 sem, scénarios 12 mois modifiables | À FAIRE | tableaux/ |
| L14 | Organisation cible, revue décisions, 4 horizons | À FAIRE | |
| L15 | Registre garder/réparer/tester/développer/reporter/arrêter + tableau hebdo (indicateurs définis + source) + 5 décisions immédiates (possible maintenant ? preuve manquante ? risque de différer ? invalidation) | À FAIRE | |
| LF | Réponse à la question finale (offre/marque, où investir argent+temps, place Galaxus/stock, financement, preuves avant accélération) | À FAIRE | RAPPORT_FINAL.md |

## S22 — Organisation du travail
| ID | Exigence | Statut | Preuve |
|---|---|---|---|
| 22.1 | Arborescence : BRIEF_MAITRE, COUVERTURE, SOURCES, ETAT, calculs/, tableaux/, analyses/, RAPPORT_FINAL | EN COURS | audit-shopify/ |
| 22.2 | Sources et base financière d'abord ; agrégations puis exemples ; emails échantillonnés ; sources conservées | EN COURS | |
| 22.3 | Sous-agents (max 3 : Ads/feed/tracking ; parcours/SAV/avis/fidélisation ; benchmark/repositionnement/SEO/UGC/Europe), mandat + sources + définitions transmis ; pilote garde finance/cash/financement/stock-Galaxus/synthèse et contrôle les preuves | À FAIRE | |
| 22.4 | Points d'avancement courts ; sauvegarde avant limite de contexte ; à la reprise lire ETAT, SOURCES, COUVERTURE | PERMANENT | ETAT.md |
| 22.5 | Vérification finale section par section (réalisé / partiel + limite / bloqué + donnée) | À FAIRE | fin de COUVERTURE |
| 22.6 | Relecture indépendante finale (calculs, doubles comptes, attribution, preuves faibles, scénarios irréalistes, omissions) | À FAIRE | analyses/relecture_independante.md |
