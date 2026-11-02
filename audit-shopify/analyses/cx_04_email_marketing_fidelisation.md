> **ERRATUM 2026-11-02 23:30 (pilote).** Les chiffres de ce fichier reposent sur une TVA de 8,1 % extraite des prix. Le dirigeant déclare le forfait TDFN 2,1 % du CA TTC (non prouvé, relevés inaccessibles). Lire : contribution avant pub **40,3 CHF/commande** (et non 28,8), ROAS global d équilibre **≈ 5,4** (et non 7,6), résultat 2026 avant rémunération **+11,9 k CHF** (et non −21,2 k). Les conclusions « la pub dépasse la contribution » deviennent « la pub marginale (≈ 42-75 CHF/commande) dépasse la contribution unitaire (40,3) ; la moyenne reste légèrement positive ». Voir `fin_00_base_financiere.md`.

# CX-04 — E-mail marketing, fidélisation et croissance de la demande (BRIEF §10, §3, §19)

Sous-agent n°2. Lecture seule (Klaviyo API GET, Postmark GET, DNS public, Shopify, DB SELECT, code du dépôt). **Aucun envoi, aucune écriture.** Date : 2026-11-02. Montants CHF TTC sauf mention ; les montants Klaviyo sont « attribués par la plateforme » (la devise du compte est USD, valeurs probablement saisies depuis des commandes en CHF : **à ne pas lire comme CHF vérifiés**). Aucun profil nominatif.

Convention : **Fait** · **Interprétation** · **Hypothèse** · **Reco** · **Confiance**.

---

## 0. Verdict

1. **Ce qui est réellement actif** : 1 flow (panier abandonné, 2 e-mails, actif, modifié le 2026-10-28) et **aucune campagne en 2026**. Les 4 campagnes BFCM 2025 ont été envoyées (11 nov. → 4 déc. 2025). Bienvenue, remerciement/post-achat et suivi sont des **brouillons non configurés**. Les 4 segments sont **inactifs (0 profil)**. SMS : 0 abonné. L'hypothèse « aucun mailing » est **fausse pour 2025** et **vraie pour 2026**.
2. **BFCM 2026 n'existe que dans le code** (`bfcm/`, non suivi par git) : calendrier (sélection 5 nov. 18:30, invitation 12 nov., préouverture 22 nov., VIP 26 nov. 19:00, public 27 nov. 09:00, clôture 30 nov. 18:30), règles d'éligibilité (promo ≤ 50 % du prix de référence, stock local vérifié, livraison 48 h) et exclusions SAV. **Aucun client Klaviyo/Shopify/Gmail n'est connecté** ; le code stipule « Sync stays off until those sources are connected and the send gate is green ». Rien n'est programmé dans Klaviyo.
3. **Base utilisable réelle : 1 016 profils « abonnés »** (12,4 % des 8 192 profils avec e-mail), pas 8 312. **7 163 profils sont « jamais abonnés »**, et Klaviyo les marque pourtant « peut recevoir du marketing » (≈ 7 060 profils avec « Accepts Marketing = faux »). Risque de conformité (LCD art. 3 al. 1 let. o) et de délivrabilité.
4. **Rendement e-mail 2025 très faible** : campagne « bcfm » (11 nov.) : 3 521 destinataires, 4,9 % de clics, **1,79 % de désabonnements (61)**, 2,9 % de rebonds, **3 commandes attribuées** (≈ 2 775 en devise plateforme). L'ensemble des 4 campagnes : 7 commandes attribuées (≈ 3 422). Le flow panier abandonné : 31 commandes attribuées sur 12 mois (≈ 14 517). **Attribution plateforme ≠ ventes supplémentaires ≠ bénéfice.**
5. **Réachat faible et lent** : 4-5 % à 90 jours, 6,4 % à 180 j., 9,6 % à 12 mois (cohorte 2025). Médiane 51 j. entre 1ʳᵉ et 2ᵉ commande. Levier financier modeste (CHF 2,8k à 11k de contribution annuelle pour +2 à +8 points de réachat), très inférieur à la perte après publicité (−CHF 17,9k sur 10 mois, pilote).
6. **Les codes promo réduisent la marge de moitié** : 25 % des commandes 2026 utilisent un code (« first10 » 357, « GSF-SPD-* » 319) ; contribution avant pub CHF 16-20 par commande contre CHF 35 sans code.
7. **Avant BFCM (3 jours)** : (a) n'envoyer qu'aux profils **abonnés** ; (b) exclure les ≈ 152 clients en incident ; (c) vérifier SPF/DKIM/DMARC (SPF racine = `secureserver.net` seul ; DMARC `p=none`) ; (d) corriger le fuseau Klaviyo (US/Eastern) ; (e) fixer des attentes réalistes : **≈ 1 000 abonnés = quelques commandes**, pas un levier majeur.

---

## 1. Accès testés

| Source | Statut | Remarque |
|---|---|---|
| Klaviyo API (lecture) | **OK** (compte SNrtt2, organisation resell-lausanne, Bussigny, fuseau US/Eastern, devise USD) | listes, segments par identifiant, flows, campagnes, rapports, profils agrégés, formulaires, modèles |
| Klaviyo : liste des segments | liste retourne 0, mais 4 segments lisibles par identifiant | écart API à noter |
| Postmark | **OK** | flux « broadcast » vide (45 j.) ; usage marketing nul |
| DNS public (SPF, DMARC, CNAME) | **OK** | voir §3.4 |
| Shopify (commandes, clients, retours) | **OK** | |
| DB (SELECT) | OK | |
| Code `bfcm/` (schedule, offers, index, audience, holds) | **lu en partie** | `registration.ts`, `identity.ts`, `sizes.ts`, `bfcm.test.ts` non lus en détail |
| Gmail | **KO** | aucune boîte accessible ; les règles de blocage SAV du code dépendent d'un accès Gmail non connecté |

---

## 2. Inventaire réel : actif, préparé, absent

### 2.1 Klaviyo (Fait, lu le 2026-11-02)

| Objet | État | Détail |
|---|---|---|
| Listes (5) | actives | « Email List » 927 ; SMS 0 ; « facebook » 54 ; « Preview List » 1 ; « BCFM_2025_Waitlist » 39 |
| Segments (4) | **inactifs, 0 profil** | « Shopify marketing ancien » ; « Popup/Instagram (nouveaux) » (condition logiquement vide) ; « VIP Customers (Shopify) » (> 5 commandes + consentement) ; « all the people who as bought in the bcfm » |
| Flows (4) | 1 live | **Abandoned Cart Reminder** (live ; e-mails à +3 h et +48 h ; modifié le 2026-10-28) ; Customer Thank You New vs Returning (brouillon) ; Onboarding Welcome Series (brouillon, non configuré) ; tracking e-mail + SMS (brouillon). Un flow supplémentaire (id Upg4pa, 39 destinataires) apparaît dans les rapports mais pas dans la liste |
| Campagnes e-mail (8) | 4 envoyées BFCM 2025 (11 nov., 22 nov., 28 nov., 4 déc.) + 1 test A/B de mars 2025 ; 3 brouillons | expéditeur `@resell-lausanne.ch` ; « smart sending » activé ; `ignore_unsubscribes = false` |
| Campagnes SMS | 0 | aucun consentement SMS |
| Formulaires | 1 (« Black Friday Banners », brouillon) | la capture réelle passe par la case Shopify au paiement (968 consentements « SHOPIFY ») |
| Modèles | 6 | |
| Mesures | 56 | incluant « Bounce suppression added » |

### 2.2 Préparation BFCM 2026 (Fait : code du dépôt)

- Calendrier (Europe/Zurich) : sélection 2026-11-05 18:30 ; invitation 11-12 ; préouverture/inscription 11-22 ; ouverture VIP 11-26 19:00 ; ouverture publique 11-27 09:00 ; rappel vendredi 18:30 ; disponibilités week-end 11-29 18:00 ; clôture 11-30 18:30.
- Offres : réduction ≤ 50 % du prix de référence, **stock local vérifié**, livraison 48 h (`delivery_48h_eligible`), prix de référence « validé ». **Choix prudent** : il évite de promettre à nouveau un sourcing lent. À conserver.
- Audience (`bfcm/audience.ts`) : ordre de priorité suppression native → exclusion SAV/manuelle → achat/fréquence → audience → personnalisation ; un clic ou un changement de taille ne lève pas un blocage ; consentement jamais écrit par le code.
- Exclusion (`bfcm/holds.ts`) : propriétés Klaviyo `rl_bf_2026_excluded`, `rl_marketing_hold` (segment `EXCLUSIONS_MARKETING_BFCM`) ; recherche Gmail multilingue FR/DE/EN (« pas reçu », « nicht erhalten », « not received », « chargeback »…) ; libellés `MARKETING/BLOQUE_SAV`.
- **Aucune propriété `rl_*` n'est visible dans les profils agrégés lus** (consistent avec « sync off »).

### 2.3 Interprétation

- La **conception** BFCM est saine sur trois points (stock local, exclusion des clients en litige, pas d'écriture de consentement). Sa **mise en œuvre est à 0 %** dans les outils : tout reste à connecter en 3 jours avant la sélection.
- L'**exclusion des clients en incident** n'est actuellement possible qu'avec une source SAV qui n'est pas connectée (Gmail). Pour pallier, des données Shopify/DB permettent de créer **une première liste d'exclusion** (§5.2).

**Confiance : haute** sur l'inventaire (lu par API/code) ; **moyenne** sur l'état exact du VPS (non vérifié).

---

## 3. Base utilisable, consentements, délivrabilité

### 3.1 Fait — profils (agrégats ; `donnees_brutes/klaviyo/profiles_agg*.json`)

| Indicateur | Valeur |
|---|---|
| Profils au total | 8 312 (avec e-mail : 8 192) |
| Créés par an | 2024 : 1 778 ; 2025 : 2 875 ; 2026 : 3 659 |
| Consentement e-mail | **abonnés 1 016** ; désabonnés 133 ; **jamais abonnés 7 163** |
| « Peut recevoir du marketing » | 8 066 profils dont ≈ 7 060 jamais abonnés (« Accepts Marketing » = faux) |
| Suppressions | désabonnement 132 ; rebond dur 111 ; spam 1 ; suppression manuelle 2 |
| Méthodes de consentement | SHOPIFY 968 ; page de préférences 97 ; import de liste 50 ; formulaire Klaviyo 32 |
| SMS abonnés | 0 (3 455 numéros connus) |
| Propriété « Ta pointure » | 12 profils |
| Clients Shopify uniques (commandes hors test, 2022-2026) | 5 793 |

Taux de capture : 1 016 abonnés / 5 793 clients ≈ **17,5 %** (si tous les abonnés sont des acheteurs : borne haute).

### 3.2 Interprétation

- La base « envoyable » dans la logique Klaviyo est 8 066 ; la base **défendable** est **1 016** (consentement explicite). Les 7 163 « jamais abonnés » incluent des acheteurs : LCD art. 3 al. 1 let. o autorise le message sans consentement uniquement si les coordonnées ont été obtenues à la vente, **le client a été informé de son droit d'opposition**, et la publicité concerne des produits similaires. La politique de confidentialité lue parle de « consentement … lorsque celui-ci est requis » et de désinscription par lien ; **elle ne dit pas** que les acheteurs seront sollicités sans consentement. **À ne pas utiliser comme base** sans analyse juridique.
- Les 3,521 destinataires de « bcfm » en 2025 sont **3,5 fois plus nombreux que les 1 016 abonnés actuels** → hypothèse : la campagne a visé un segment plus large que le consentement explicite (il faudrait la définition du segment 2025, non disponible). Le taux de désabonnement de 1,79 % (61) va dans ce sens.
- Taux de rebond : 2,9 % (campagne), 1,1 % puis 3,7 % (2 e-mails du flow) ; 111 rebonds durs sur 8 192 adresses (1,4 %) : **adresses erronées de saisie** probables (cf. erreurs de saisie au checkout).

**Confiance : haute** sur les comptages ; **moyenne** sur l'interprétation de la base 2025.

### 3.3 Qualité de segmentation par taille

- Propriété Klaviyo : 12 profils : inutilisable.
- Depuis les lignes de commande Shopify (2026 : 3 415 lignes) : **taille identifiable sur 92,2 %** des lignes ; taille connue pour **5 465 clients / 5 793 (94,3 %)**. Top tailles : 38 (243), 42 (242), 43 (232), 39 (227), 44 (224), 40 (199), S (189), M (177), 41 (148), 42,5 (141).
- Cohérence : parmi 787 clients avec ≥ 2 lignes de taille connue, **32 %** n'ont qu'une taille, **89 %** au plus deux tailles. → la taille d'un client est un indicateur **utile mais pas fiable seul** (cadeaux, enfants, marques à taille variable, vêtements S/M/L). 
- **Reco** : segmenter par « dernière taille achetée + catégorie » et confirmer par un clic sur l'e-mail ; ne jamais présenter la taille comme certaine ; utiliser `variantTitle` des commandes comme source (pas la propriété manuelle). Mesurer le taux de clic par segment taillé.

**Confiance : moyenne** (cohérence par client mesurée sur lignes ; tailles de vêtement hétérogènes).

### 3.4 Délivrabilité : DNS (Fait, requêtes publiques du 2026-11-02)

- SPF racine : `v=spf1 include:secureserver.net -all` (GoDaddy seul ; refus strict). **Ni Postmark, ni Klaviyo, ni Microsoft 365 n'y figurent**, alors que les MX pointent vers Microsoft 365 (`*.mail.protection.outlook.com`).
- DMARC : `v=DMARC1; p=none` (sans adresse de rapport).
- `pm-bounces.resell-lausanne.ch` → CNAME `pm.mtasv.net` (Return-Path Postmark configuré).
- Klaviyo : TXT de vérification de site présent ; **aucun CNAME DKIM Klaviyo trouvé** sur les sélecteurs essayés (kl, kl2, k1, s1, s2, selector1/2, default, google). Les sélecteurs réels ne sont pas connus : **conclusion DKIM impossible**.
- Interprétation : les e-mails Klaviyo partent avec un expéditeur `@resell-lausanne.ch` ; sans SPF/DKIM alignés, la délivrabilité vers Gmail/Yahoo est à risque ; **le SAV envoyé depuis une boîte Microsoft 365 échouerait au SPF racine** si la boîte est bien hébergée chez Microsoft (hypothèse). DMARC en `none` ne bloque rien mais n'apporte aucune visibilité.
- **Confiance : moyenne** (diagnostic DNS partiel, sélecteurs DKIM inconnus).

---

## 4. Évaluation des flows et campagnes

### 4.1 Fait — rendement (plateforme)

| Dispositif | Volume | Résultat attribué par la plateforme | Désabonnements / rebonds |
|---|---|---|---|
| Campagne « bcfm » 2025-11-11 | 3 521 envoyés, 3 418 livrés | clics 4,9 % ; ouvertures 52 % (peu fiable : protection de confidentialité Apple) ; **3 commandes ≈ 2 774,70** | désabonnements 1,79 % (61) ; spam 2 (0,059 %) ; rebonds 2,9 % (103) |
| « bcfm2 » 2025-11-22 | 558 | 1 commande ≈ 190 | — |
| « Campaign Nov 28 » | 563 | 3 commandes ≈ 457,20 | — |
| « Campaign Dec 4 » | 159 | 0 commande | — |
| Panier abandonné, e-mail 1 (+3 h) | 627 destinataires / 12 mois | 11 commandes ≈ 5 020,75 | 1,9 % désabonnés ; 1,1 % rebonds |
| Panier abandonné, e-mail 2 (+48 h) | 702 | 20 commandes ≈ 9 496,55 | 0,74 % ; 3,7 % rebonds |

Contexte : ventes brutes TTC nov.-déc. 2025 ≈ CHF 185k (nov. 59,97k, déc. 125,49k, API Shopify, 728 commandes) ; **les commandes e-mail attribuées 2025 = 7 (≈ 3,4k) ≈ 1,8 % de ces ventes**. C'est un **plafond** (attribution par dernier clic, non incrémentale) pas un chiffre de ventes supplémentaires.

### 4.2 Interprétation — marge réelle

Contribution avant pub par commande 2026 (pilote) : ≈ CHF 30,6 ; ≈ 12,9 % du brut TTC. Si les 7 commandes de BFCM 2025 avaient été 100 % incrémentales, leur contribution serait ≈ CHF 3,4k × 12,9 % ≈ **CHF 0,44k**, avant coût d'outil et de temps (non extraits) et **avant perte de 61 abonnés** (1,79 %). Pour le panier abandonné : ≈ CHF 14,5k × 12,9 % ≈ CHF 1,9k au plus, et probablement 1/3 à 1/2 incrémental. **Ces ordres de grandeur ne justifient pas un effort lourd en volume** ; ils justifient des automatisations maintenues à faible coût et un **contrôle strict des remises**.

### 4.3 Codes de réduction et marge (Fait, pilote `fin_05`, 2 882 commandes 2026)

| Famille | Commandes | Part | Panier brut TTC | Contribution avant pub / cmd | % du brut | Remb./brut |
|---|---|---|---|---|---|---|
| Sans code | 2 172 | 75 % | 249 | **35** | 14 % | 9 % |
| « GSF-* » (app promo) | 319 | 11 % | 200 | 16 | 8 % | 5 % |
| Autre code (dont « first10 » 357) | 391 | 14 % | 206 | 20 | 10 % | 10 % |

Interprétation : les codes divisent la contribution par ≈ 2 ; les commandes avec code ont un panier plus bas (200 vs 249). **Non démontré** que le code provoque la commande (sélection : clients à panier plus faible). **Reco** : tout code à valeur monétaire doit être testé en contribution totale (commandes × contribution), avec témoin ; un code de 10 % sur une marge ≈ 13-15 % consomme plus des deux tiers de la contribution.

### 4.4 Évaluation de chaque dispositif (justification par les données)

| Dispositif | État | Justifié par nos données ? | Priorité | Remarque |
|---|---|---|---|---|
| Panier abandonné | actif | Oui, modeste (31 commandes attribuées/an) | Maintenir ; nettoyer | 2ᵉ e-mail : 3,7 % de rebonds → valider les adresses ; limiter aux profils abonnés ou à l'adresse collectée au paiement pour une relance de commande déjà commencée (base juridique à valider) ; pas de code promo par défaut |
| Bienvenue | brouillon | Oui si le volume d'abonnés justifie (≈ 100/mois) | Moyenne | Contenu : promesse de livraison **vraie**, aide au choix de taille, capture de préférences ; **pas** de code systématique |
| Post-achat (remerciement, suivi) | brouillon | Le suivi est déjà géré par Shopify/Swiss Post/ALLIN-ONE/Postmark ; **ne pas dupliquer** | Faible | Garder les messages de service hors Klaviyo (voir §5.1) |
| Demande d'avis | Judge.me (non lu) | Oui (réputation, `cx_03`) | Moyenne | Envoi **après livraison confirmée**, uniforme |
| Réachat | absent | Données : médiane 51 j. ; 4,4-5,0 % à 90 j. | Moyenne-faible | Déclencher à J+45-60 pour acheteurs satisfaits sans incident ; sélection par taille/catégorie ; gain §6 |
| Réactivation | absent | Base non consentie majoritaire | **Ne pas faire** tant que la base n'est pas assainie | |
| VIP | segment défini « > 5 commandes » | **9 clients seulement** ; ≥ 3 commandes : 82 | À redéfinir | Seuil ≥ 3 commandes ou ≥ CHF 600 cumulés ; attention aux revendeurs (un client a 165 commandes, un autre 28) |
| Retour en stock / alerte taille | absent | Cohérent avec un catalogue de paires uniques par taille | À tester | Besoin d'un signal de stock fiable (non audité) |
| Liquidation / saisonnier (BFCM) | code prêt, rien programmé | **Non démontré** : rendement e-mail 2025 très faible (§4.1) | Voir §5 | Les promesses doivent porter sur stock local 48 h |
| SMS | 0 | Aucun consentement | Non | |

Séparation service/marketing : Postmark (transactionnel + un flux « broadcast » inutilisé) pour le service ; Klaviyo pour le marketing ; ne **jamais** glisser une promotion dans un e-mail de statut.

**Confiance : moyenne** — rendements plateforme non incrémentaux ; coûts d'outil et de temps non connus.

---

## 5. BFCM 2026 : conditions de lancement et attentes

### 5.1 Garde-fous obligatoires (« send gate »)

1. **Audience = profils abonnés uniquement** (1 016 aujourd'hui) ; interdire l'envoi aux « jamais abonnés » dans tous les segments/campagnes/flows promotionnels (la propriété `can_receive` n'est pas un consentement).
2. **Exclusion** `EXCLUSIONS_MARKETING_BFCM` alimentée avant le 5 nov. (§5.2).
3. **Un seul message à la fois** par personne : smart sending activé (OK) + plafond de fréquence ; le calendrier prévoit 6 à 8 envois en 4 semaines : **le désabonnement de 1,79 % constaté en 2025 sur un seul envoi impose de réduire**.
4. **Fuseau** : le compte Klaviyo est en US/Eastern ; les horaires du plan sont en Europe/Zurich. Vérifier la planification (6 h d'écart, selon la saison).
5. **Authentification** : corriger SPF (inclure Klaviyo, Postmark, Microsoft 365 selon les expéditeurs réels), DKIM de chaque expéditeur, DMARC avec adresse de rapport, avant la première campagne de volume.
6. **Promesse** : ne mettre en avant que le stock local 48 h ; ne jamais renvoyer vers des articles à sourcer.
7. **Prix de référence** : documenter ce qu'est `reference_price_chf` (OIP art. 16-17, voir `cx_03`) avant d'afficher « -x % ».
8. **Aucun e-mail promotionnel** à une personne ayant une commande non expédiée > 14 jours, un litige, un retour ouvert ou une réclamation.

### 5.2 Taille de l'exclusion à partir de Shopify/DB (sans Gmail)

Clients distincts, hors test : commande payée non expédiée > 14 j. : **97** ; litige bancaire sur 12 mois : **23** ; retour Shopify ouvert/demandé : **37** ; union ≈ **152 clients** (4,5 % des 3 344 clients ayant commandé depuis nov. 2025). S'y ajoutent les clients ayant eu une annulation/remboursement total depuis août (59, à traiter au cas par cas) et les cas hors Shopify (boîte SAV). Données : `calculs/cx_04_cohortes.py`, comptage ad hoc ; les identifiants sont des identifiants Shopify non exportés. **Reco** : exporter cette liste vers la propriété `rl_marketing_hold` (hors de ce rapport, à faire par le propriétaire du processus).

### 5.3 Attentes réalistes (scénarios, **hypothèses**)

Base 2025 : conversions attribuées par campagne = 0,09 % (« bcfm »), 0,18 %, 0,53 %, 0 % des destinataires. Avec ≈ 1 000 abonnés exploitables :

| Scénario | Taux de commande par envoi | Commandes par envoi | Pour 5 envois | Contribution avant pub (CHF 13-30/cmd) |
|---|---|---|---|---|
| Prudent | 0,1 % | 1 | 5 | CHF 65 – 150 |
| Médian | 0,3 % | 3 | 15 | CHF 195 – 450 |
| Favorable (offres 48 h très attractives) | 1 % | 10 | 50 | CHF 650 – 1 500 |

**Conclusion** : l'e-mail BFCM 2026 sur la base consentie **ne peut pas être le moteur** de la période. Il sert à (a) informer les clients fidèles, (b) tester l'offre 48 h, (c) alimenter l'audience de remarketing avec des profils consentis. Le moteur reste les publicités et l'offre (autres sous-agents). Il serait trompeur de lui attribuer le CA total de la période.

**Confiance : faible à moyenne** : conversions 2025 sur segment plus large et sur des offres différentes.

---

## 6. Cohortes de réachat, panier, délai, marge

Sources : `orders_api.ndjson` (clients identifiés pour 99,6 % des commandes) ; contribution : P&L pilote `fin_05` ; scripts `calculs/cx_04_cohortes.py` ; tables `cx_04_reachat_taux.csv`, `cx_04_contribution_par_rang.csv`, `cx_04_mensuel_2022_2026.csv`. Commandes annulées exclues.

### 6.1 Fait

| Cohorte (1ʳᵉ commande) | Horizon | Clients éligibles | Réachat | Taux |
|---|---|---|---|---|
| 2024 | 30 j. / 90 j. / 180 j. / 12 mois | 1 099 | 23 / 34 / 56 / 74 | 2,1 % / 3,1 % / 5,1 % / 6,7 % |
| 2025 | 30 j. | 1 947 | 63 | 3,2 % |
| 2025 | 90 j. | 1 947 | 98 | 5,0 % |
| 2025 | 180 j. | 1 947 | 125 | 6,4 % |
| 2025 | 12 mois | 1 287 | 123 | 9,6 % |
| 2026 | 30 j. / 90 j. / 180 j. | 2 234 / 1 556 / 961 | 69 / 69 / 43 | 3,1 % / 4,4 % / 4,5 % |

- Clients identifiés : 5 793 ; **474 (8,3 %) ont ≥ 2 commandes** ; 82 en ont ≥ 3 ; **9 en ont > 5** (donc le segment « VIP > 5 commandes » compte 9 personnes).
- Délai entre 1ʳᵉ et 2ᵉ commande (réacheteurs) : médiane **51 jours** (P25 14, P75 190) ; 51 réachats le même jour (doublons de panier) ; hors ceux-ci médiane 79 jours.
- 2026 : commandes de rang ≥ 2 = 323 (11,4 %), CA brut 14,2 % ; **seulement 144 commandes (5,1 %) viennent de clients acquis avant 2026**.
- Panier brut TTC moyen/médian 2026 : rang 1 : 231,7 / 189 ; rang 2 : 268,9 / 208,7 ; rang ≥ 3 : 382,7 / 229.
- Taux de remboursement (remboursé/brut) 2026 : rang 1 : 6,3 % ; rang ≥ 2 : 2,4 %.
- Contribution avant pub par commande (pilote) : rang 1 **CHF 28** ; rang ≥ 2 **CHF 47** ; médiane CHF 27,6 / 35,2.
- Concentration : 9 clients ≥ 4 commandes en 2026 = 47 commandes, CHF 23,1k brut (3,3 % du brut 2026) → présence probable de **revendeurs / clients B2B** ; un client a 165 commandes en 2023-2026.
- Mensuel : 85-92 % des commandes sont des 1ʳᵉ commandes (2024-2026).

### 6.2 Interprétation

- Le réachat est **faible et lent** ; la clientèle est **majoritairement ponctuelle** (modèle « chasse à la paire »). La médiane de 51 j. rend un flow « J+30 » prématuré ; une relance à J+45-60 est plus cohérente.
- La contribution plus élevée des commandes récurrentes (47 vs 28) n'est **pas incrémentale** : les clients qui reviennent sont plus engagés et achètent des paniers plus importants (biais de sélection).
- **Sensibilité** (≈ 3 000 nouveaux clients par an) : +2 points de réachat à 12 mois ≈ 60 commandes ≈ CHF 2,8k de contribution avant pub ; +8 points ≈ 240 commandes ≈ CHF 11,3k (au taux de contribution rang ≥ 2 de CHF 47). À comparer à la **perte annuelle après pub Google de −CHF 17,9k sur 10 mois** : **la fidélisation seule ne corrige pas le résultat** ; elle ne suffit pas, mais ne coûte pas d'acquisition.
- Coût de fidélisation : outils + temps (non connus) + remises ; une remise de 10 % sur un panier de ≈ CHF 270 coûte ≈ CHF 27, soit plus de la moitié de la contribution de CHF 47 → l'effet net devient faible : **préférer les avantages non monétaires** (accès anticipé, alerte de taille, livraison prioritaire).

**Confiance : moyenne** — corrélations, pas d'incrémentalité ; revendeurs non exclus ; contribution = moyenne pilote.

---

## 7. Recommandations (impact × coût × capacité)

| # | Action | Impact probable | Coût / délai | Preuve attendue |
|---|---|---|---|---|
| 1 | Assainir la base : envoyer **uniquement aux abonnés** ; supprimer des segments marketing les « jamais abonnés » ; purge des rebonds durs | Évite désabonnements, plaintes, filtres ; protège les 1 016 abonnés | quelques heures ; immédiat | taux de désabonnement < 0,5 % par envoi, spam < 0,1 % |
| 2 | Authentification (SPF/DKIM/DMARC) | Délivrabilité de Klaviyo et du SAV | 1-2 h (DNS) + vérification | rapports DMARC, taux de rebond < 2 % |
| 3 | Liste d'exclusion incidents → `rl_marketing_hold` avant le 5 nov. | Évite d'inciter un client en litige | 2-4 h | 0 envoi à un client en incident |
| 4 | Limiter BFCM 2026 à 3-4 envois (invitation, ouverture VIP, ouverture publique, rappel/clôture) | Moins de désabonnements (1,79 % par envoi observé) | planification | désabonnements cumulés < 3 % |
| 5 | Bienvenue en 2 messages (promesse de livraison vraie, aide à la taille, préférences) **sans code systématique** | Meilleure base de segmentation | 1 jour | taux de clic sur « ma taille » |
| 6 | Redéfinir VIP (≥ 3 commandes ou ≥ CHF 600 cumulés, hors revendeurs) | Segment utile (≈ 82 personnes) | 1 h | — |
| 7 | Réachat J+45-60, par taille/catégorie, sans remise | +2 à +8 points de réachat possibles | 1-2 jours | réachat à 90 j. des exposés vs témoins |
| 8 | Alerte de taille / retour en stock (si un signal de stock fiable existe) | Cohérent avec le modèle ; à tester | à chiffrer | clic → commande |
| 9 | Réseaux sociaux, partenariats, affiliation, canaux payants nouveaux : **ne rien lancer avant** correction du délai et du stock de commandes bloquées ; si lancé, plafond de coût d'acquisition par commande très inférieur à la contribution moyenne avant pub (CHF 30,6, déjà nette des remboursements) ; pour mémoire la pub Google 2026 coûte ≈ CHF 35 par commande (CHF 100,9k / 2 882, pilote), donc déjà au-dessus | Peu de marge pour une commission ou un code | — | contribution après coût par commande > 0 |

Autres leviers (réseaux sociaux, UGC, communauté, partenariats, affiliation) : **non étudiés quantitativement** faute de données de ces canaux ; l'ordre ci-dessus tient compte de la marge disponible (≈ 13-15 % du brut) : toute commission ou remise supérieure à ≈ 10 % détruit l'essentiel de la contribution.

---

## 8. Mesure du résultat : contribution et cash, pas CA plateforme

- **Métrique principale** : contribution conservée par destinataire sur 30 jours = (commandes × contribution moyenne) − remboursements − remises − coûts, rapportée au nombre d'expédiés. À calculer sur les **commandes Shopify** (jointure par e-mail haché), pas sur « revenu attribué ».
- **Témoin** : conserver 10 % d'abonnés aléatoires hors campagne. **Limite** : avec ≈ 1 000 abonnés, 100 témoins ne détectent qu'un écart d'au moins quelques points de pourcentage ; le pilote **montrera** un ordre de grandeur et **ne prouvera pas** de petit effet (l'incertitude restante est comparable à l'effet attendu).
- **Cash** : l'e-mail BFCM n'engage presque aucun cash (coût d'outil) mais une promotion à stock local immobilise du stock (à mesurer par les autres sous-agents).
- **Ne pas additionner** : un gain de réachat, une baisse de CAC et un gain de conversion peuvent décrire les mêmes commandes.
- **Arrêt** : si le désabonnement dépasse 1 % d'un envoi, ou si les rebonds dépassent 3 %, stopper et auditer l'audience.

---

## Limites et données manquantes

- Klaviyo : montants en « devise plateforme USD » vs commandes CHF ; attribution plateforme (fenêtres de clic/ouverture non lues) ; segment « bcfm » 2025 non redéfini ; flow Upg4pa non détaillé ; consentement par profil non rapproché à la commande (pas de jointure PII).
- Pas de coût d'outil (plan Klaviyo, Judge.me, apps) ni de temps passé : le coût de fidélisation est **non calculable**.
- Les 7 163 profils « jamais abonnés » : source de collecte non identifiable individuellement ; information d'opposition donnée au paiement non lue (modèle Shopify non accessible).
- Tailles : fiabilité par client mesurée sur lignes ; pas de table de correspondance marques/tailles.
- DKIM : sélecteurs inconnus, conclusion impossible ; SPF/DMARC lus par DNS public.
- Code `bfcm/` : `registration.ts`, `identity.ts`, `sizes.ts`, `bfcm.test.ts` non analysés en détail ; état d'exécution sur le VPS non vérifié.
- Réseaux sociaux, affiliation, partenariats : aucune donnée de performance.
- Informations nécessaires du dirigeant : (1) définition du segment envoyé en 2025 ; (2) accès aux boîtes SAV pour l'exclusion ; (3) liste des expéditeurs réels (Klaviyo, Postmark, Microsoft 365, autres) pour l'authentification ; (4) coût mensuel des outils ; (5) source des codes « first10 » et « GSF-SPD-* » et leur règle d'attribution.
