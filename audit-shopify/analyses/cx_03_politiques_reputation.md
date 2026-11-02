# CX-03 — Politiques (retour, échange, annulation, remboursement, avoir) et réputation (BRIEF §9, §3, §19)

Sous-agent n°2. Lecture seule. Date : 2026-11-02. Ceci est une **analyse d'audit, pas un avis juridique** : les points marqués « à faire valider » doivent être revus par un juriste suisse (et, pour l'UE, par un conseil connaissant les droits nationaux).

Convention : **Fait** · **Interprétation** · **Hypothèse** · **Reco** · **Confiance**.

---

## 0. Verdict

1. **En Suisse, la politique de retour volontaire (14 j., frais de 10 %, crédit/échange sans remboursement) est légale** : il n'existe pas de droit de rétractation légal pour l'achat en ligne (SECO, KMU/admin.ch). Le problème n'est pas la légalité mais (a) la **cohérence d'application** (un client public se plaint d'un prélèvement de 15 % ; 9 notes de remboursement parlent de « 10 % retenu » pour des **annulations**, sans clause lue qui le prévoit), (b) les **litiges bancaires « crédit non traité »** (10 en 12 mois).
2. **Le vrai risque juridique est la promesse de délai** : l'information officielle KMU/admin.ch indique que des délais « trop courts et impossibles à tenir à la seule fin d'attirer des clients » sont déloyaux (LCD). Réalité mesurée : livraison médiane 13 j.o. (Standard, promesse 5-10) et 10 j.o. (Express, promesse 2-5) — voir `cx_01`.
3. **Deux versions de la politique d'expédition** sont visibles (API Shopify mise à jour le 2026-06-14, et une page publique « fr-fr/policies/shipping-policy » avec « 2 à 12 jours » et « Resell-lausanne.ch ne peut être tenu responsable des colis perdus ou volés »). **À confirmer laquelle est servie** ; la seconde est incompatible avec la règle UE (risque jusqu'à la réception à la charge du vendeur).
4. **Affichage d'avis** : la page « Avis » affiche « 4,9 ★ — 589+ avis vérifiés » (Judge.me + Trustpilot + Google + Instagram, nombre saisi à la main dans la section du thème, valeur par défaut 589). Judge.me seul : **410 avis, note recalculée ≈ 4,66**. Le mot « vérifiés » appliqué à un total mixte est **un risque d'indication fallacieuse** (LCD art. 3 al. 1 let. b).
5. **Exploitant** : la politique désigne « Solutions Manzinali », raison individuelle (IDE CHE-309.864.712, Bussigny) ; une version cite « Resell Lausanne / Théo Manzinali, entreprise individuelle ». **Responsabilité personnelle illimitée** (hypothèse structurelle, non juridique) et tout changement de nom commercial doit conserver cette identité légale.
6. **Priorités** : (1) aligner promesses et réalité (`cx_01` P1) ; (2) clarifier cancellation/frais ; (3) publier le délai de réponse réel (la page contact annonce « 24-48 jours ouvrables » — probablement une faute pour « heures ») ; (4) corriger l'affichage d'avis ; (5) plan de réparation de réputation par le service, pas par la collecte sélective.

---

## 1. Accès testés

| Source | Statut |
|---|---|
| Politiques Shopify (API `read_legal_policies`) : contact, mentions légales, confidentialité, remboursement, expédition, CGV | **OK** (textes dans `donnees_brutes/site/policy_*.txt`) |
| Pages publiques (CGV, échanges-remboursements, livraison, avis) via HTTP/WebFetch | **OK** (la FAQ renvoie 429) |
| Fedlex (LCD RS 241 ; OIP RS 942.211) | **OK** |
| SECO, KMU/admin.ch, Konsumentenschutz | **OK** (via recherche web) |
| Your Europe (retours, livraison), Centre européen des consommateurs (Espagne) | **OK** (via recherche web) |
| EUR-Lex (directive 2011/83/UE texte intégral) | **KO** (403) → **le texte de la directive n'a pas été lu** ; les règles UE sont citées via Your Europe / ECC |
| Droits nationaux DE/AT/FR/IT/ES/NL | **Non lus** (pas de source nationale consultée sauf une page ECC espagnole) |
| Trustpilot (page profil) | **KO** (403 en accès direct) ; un seul avis indexé via recherche (3 mars 2026, positif, sans invitation) |
| Google Business / Maps | **Non accessible** |
| Judge.me | OK (page « Avis » de la boutique) |

---

## 2. Politiques actuelles vs droit

### 2.1 Fait — ce que disent les politiques (textes lus)

- **Retours Suisse** : demande dans les 14 j. calendaires suivant la réception, **autorisation préalable**, expédition sous 14 j. après acceptation, frais de retour à la charge du client, **frais de traitement 10 %**, forme de compensation : échange / remplacement / avoir / crédit boutique ; « Aucun remboursement sur le moyen de paiement initial n'est accordé par défaut » ; livraison initiale non remboursée sauf erreur/défaut. Exclusions : article > CHF 650, soldes/liquidation, produits personnalisés, etc. Le portail `/returns` applique les mêmes exclusions (« Soldes/promo ou prix > CHF 650 ») et affiche : « After inspection, you receive store credit. »
- **UE** : « un droit légal de rétractation de 14 jours **peut** s'appliquer lorsque la loi applicable le prévoit » ; remboursement « en principe sur le moyen de paiement initial » ; « seules les exclusions légales impératives » s'appliquent.
- **Annulation** : « Une fois la commande validée, elle ne peut généralement plus être annulée, car la commande peut être sourcée et des frais engagés immédiatement. » Pas de barème de frais d'annulation lu.
- **Retard (CGV et expédition)** : estimations non garanties ; « Un retard raisonnable ne donne pas automatiquement droit à annulation, indemnité ou dommages-intérêts, sauf disposition impérative contraire » ; « En cas de dépassement significatif, le Client doit d'abord accorder … un délai supplémentaire raisonnable, communiqué par écrit, avant de pouvoir demander l'annulation » ; « Resell Lausanne s'engage à informer le Client en cas de retard important connu ».
- **Frais divers** : colis non retiré renvoyé : réexpédition CHF 20 (≈ 9 étiquette retour + 7 nouvelle étiquette + solde manutention) ; conservation CHF 10/mois après 90 jours (selon lecture de la politique d'expédition).
- **Autorisation de refus** : « Si un produit ne satisfait pas à nos exigences internes de conformité, d'authenticité ou d'état, nous pouvons refuser son expédition et annuler la commande. »
- **Contact** : page publique annonçant une réponse « sous 24-48 jours ouvrables » (à confirmer : probablement « heures »).

### 2.2 Tableau politique vs règles (sources consultées le 2026-11-02)

| Sujet | Politique actuelle | Règle applicable (source) | Écart / risque | Confiance |
|---|---|---|---|---|
| Droit de rétractation CH | Retour volontaire 14 j. | « La législation suisse ne prévoit pas de droit général de révocation en cas d'achat sur l'Internet » (SECO, https://www.seco.admin.ch/fr/problemes-apres-lachat) ; idem KMU (https://www.kmu.admin.ch/fr/obligations-legales-les-lois-suisses-et-europeennes-sur-le-e-commerce) | **Aucun** : conditions volontaires librement fixables, sous réserve de transparence | haute |
| Conditions générales | CGV publiées | KMU : les CG font partie du contrat si l'acheteur a été rendu attentif avant la conclusion et a pu les lire ; LCD art. 8 : CG qui prévoient « une disproportion notable et injustifiée entre les droits et les obligations » = déloyal (Fedlex RS 241, https://www.fedlex.admin.ch/eli/cc/1988/223_223_223/fr, version du 31.12.2024) | Risque modéré sur les frais cumulés (10 % + retour à charge + livraison non remboursée + crédit seul) ; à relire | moyenne |
| Frais de 10 % sur annulation | Non prévus dans la clause lue ; 9 remboursements 2026 notés « 10 % retenu » | idem (information préalable, bonne foi) | **Pratique non documentée** : fondement contractuel à vérifier | moyenne |
| Retard de livraison CH | Estimé, non garanti ; délai supplémentaire écrit avant annulation | CO art. 102 : mise en demeure ; art. 107 al. 2 : après délai convenable, l'acheteur peut se départir du contrat ; inutile de mettre en demeure si le jour d'exécution est fixé d'un commun accord (SECO « Problèmes après l'achat » ; Konsumentenschutz https://www.konsumentenschutz.ch/online-ratgeber/lieferverzug-wenn-ware-nicht-kommt/ : les règles ne sont pas impératives mais modifiables par CG) | **Conforme dans le principe** (le mécanisme « délai supplémentaire » est celui du CO) ; **manque** : la boutique n'envoie pas de mise en demeure à sa place, elle exige du client une procédure | moyenne |
| Délais trop courts | « 5-10 j.o. » / « 2-5 j.o. » | KMU : « il serait déloyal – et cela constituerait une infraction à la LCD – d'indiquer des délais de livraison trop courts et impossibles à tenir à la seule fin d'attirer des clients » ; LCD art. 3 al. 1 let. b : indications inexactes ou fallacieuses sur ses prestations | **Risque réel** vu les mesures (`cx_01`) ; la mention « délais estimés » atténue sans supprimer | moyenne (il faudrait prouver l'intention de tromper ; le critère est objectif pour l'inexactitude) |
| Confirmation de commande | Mail Shopify en ~2 s | LCD art. 3 al. 1 let. s : identité claire, étapes techniques, détection/correction des erreurs de saisie, confirmation « sans délai » par e-mail | Conforme sur la confirmation ; identité visible (mentions légales) ; erreurs de saisie : tolérance d'adresse mal calibrée (`cx_01` P3) | moyenne |
| Prix comparatifs / « -50 % » (BFCM) | Règle code : offre ≤ 50 % du prix de référence « validé » | OIP art. 16 : prix comparatif admis si effectivement pratiqué immédiatement avant ou ≥ 30 jours consécutifs ; durée limitée à la moitié de la période, max 2 mois ; art. 17 : rabais chiffrés = prix comparatifs ; prix de catalogue/indicatifs seulement si une part prépondérante de la concurrence les pratique (Fedlex RS 942.211, https://www.fedlex.admin.ch/eli/cc/1978/2081_2081_2081/fr ; SECO FAQ https://www.seco.admin.ch/fr/faq-oip) | Dépend de ce qu'est le « prix de référence » (non précisé dans `bfcm/offers.ts` : champ `reference_price_chf` + `reference_validated`) ; **à documenter avant tout affichage « -x % »** | faible (règle de référence non lue) |
| Publicité de masse par e-mail | Klaviyo configuré pour envoyer à des profils jamais abonnés | LCD art. 3 al. 1 let. o : consentement préalable, sauf clients ayant acheté, informés de leur droit d'opposition, pour des produits similaires | Voir `cx_04` : 7 163 profils « jamais abonnés » ; la politique de confidentialité parle de « consentement … lorsque celui-ci est requis » ; **ne pas envoyer sans base claire** | moyenne |
| Avis/notes affichés | « 4,9 ★ — 589+ avis vérifiés » | LCD art. 3 al. 1 let. b | **Risque** : note et nombre saisis à la main, total mixte, Judge.me seul 410 / ≈ 4,66 | haute sur les chiffres ; moyenne sur la qualification juridique |
| UE : rétractation | « peut s'appliquer … » ; frais de 10 % absents de la section UE lue | Your Europe : 14 jours à compter de la livraison pour les biens ; le consommateur supporte les frais de retour si informé ; ECC Espagne : remboursement par le même moyen de paiement, « under no circumstances shall the consumer incur any costs as a result of the reimbursement » ; exceptions limitées (biens personnalisés, scellés ouverts…) (https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm ; https://portal-cec.consumo.gob.es/en/informacion-general/compras-online/devoluciones) | **Risque** : le portail `/returns` exclut soldes et > CHF 650 pour tous les clients ; ces exclusions sont **contraires** au droit UE pour un consommateur UE (sauf exception légale) ; clause « colis perdu non responsable » (si en vigueur) contraire à la règle du risque | moyenne (directive non lue ; droits nationaux non lus) |
| UE : livraison | estimée 5-10 j.o. | Your Europe : livraison sous 30 jours sauf accord ; si non livré, délai supplémentaire raisonnable puis résiliation et remboursement « dès que possible » (https://europa.eu/youreurope/citizens/consumers/shopping/shipping-delivery/index_en.htm) | Cohérent avec les mesures (livraison médiane < 30 j.) ; les cas > 30 j. ouvrent un droit à remboursement UE | moyenne |
| UE : garantie légale | non lue en détail | 2 ans minimum, inversion de la charge de la preuve 1 an ; biens d'occasion : ≥ 1 an convenu (Your Europe https://europa.eu/youreurope/citizens/consumers/shopping/guarantees-returns/index_en.htm) | À vérifier dans les CGV pour DE/AT/FR/IT/ES/NL | faible |
| Garantie CH | non lue en détail | 2 ans (art. 210 CO), droits art. 205-206 CO ; non réductible en B2C sauf occasion (1 an min.) (SECO) | À vérifier dans les CGV (ne pas exclure la garantie pour défaut) | faible |

Périmètre UE : **29 commandes sur 2 884** en 2026 (1 %) : FR 14, DE 3, AT 3, NL 3, IT 2, ES 1. L'exposition juridique UE est faible en volume mais **non nulle** ; le coût de conformité est faible comparé au risque d'une plainte d'autorité de consommation.

### 2.3 Interprétation

- La politique suisse est **plus sévère que la moyenne du marché** (frais 10 % + retour payé + crédit seul) mais légale. Son coût commercial est **non mesuré** : aucune donnée de conversion avant/après.
- Les chargebacks « crédit non traité » (10 ; CHF 2 068 ; 6 gagnés, 4 perdus) suggèrent que des clients s'attendent à un remboursement sur carte. Hypothèse, non prouvée : la page de retour et le mail de retour n'expliquent pas clairement le crédit.
- Le mécanisme CGV « le Client doit d'abord accorder un délai supplémentaire » est juridiquement cohérent avec CO 107 mais **opérationnellement injuste** quand l'entreprise ne prévient pas : c'est l'entreprise qui connaît le retard (tableau `StockxOrderAlert`).

### 2.4 Challenge des convictions du dirigeant

| Conviction (rapportée) | Fait | Verdict |
|---|---|---|
| Retours avec avoir et frais = protection nécessaire | Légal en CH ; mais 59 % des retours sont des tailles ; 84 % de la valeur des retours est remboursée en crédit ; seuls 46 % du crédit émis en 2026 ont été consommés en 2026 | **Partiellement fondée** : la politique protège la marge, mais produit des litiges et des critiques publiques ; pas de mesure de son effet sur la conversion |
| Annuler avec retenue de 10 % est normal | Aucune clause lue ; 9 cas ; en cas de **non-disponibilité fournisseur** (défaillance de l'entreprise), retenir 10 % est difficile à défendre (LCD art. 8) | **Non soutenue** sauf clause explicite |
| « Un délai affiché avant paiement fait fuir » | Délai déjà affiché, faux ; A/B impossible (`cx_01` §4) | **Non démontrée, non réfutée** |
| Les clients UE sont marginaux | 1 % des commandes | **Vrai en volume**, mais le droit UE s'applique dès la première commande |

---

## 3. Réputation

### 3.1 Fait — données publiques accessibles

- **Judge.me** (page « Avis », lecture du 2026-11-02) : « Based on 410 reviews » : 5★ 348 (85 %), 4★ 29 (7 %), 3★ 7 (2 %), 2★ 6 (1 %), 1★ 20 (5 %). **Note recalculée** = (348×5 + 29×4 + 7×3 + 6×2 + 20×1) / 410 ≈ **4,66**. Une lecture antérieure donnait 423 avis (écart non expliqué, probablement des avis ajoutés ou une autre vue).
- **Page affichée** : « 4,9 ★ note moyenne — 589+ avis vérifiés — Judge.me, Trustpilot, Google, Instagram » ; description « Plus de 580 témoignages ». Les valeurs 4.9 / 589 sont des **réglages manuels** de la section du thème (`resell-reviews-hub`, valeurs par défaut du schéma).
- **Trustpilot** : accès direct bloqué ; un avis positif indexé (3 mars 2026, « Review zonder uitnodiging », donc spontané) ; **note globale non obtenue**.
- **Google** : non accessible.
- **Extraits Judge.me lus** (≈ 10, non représentatifs) : positifs (produit conforme, livraison rapide, suivi par e-mail apprécié) ; négatifs : délai long (« un mois de délai trop long », « un peu long »), avis allemands : « Wartezeit ein bisschen lange, eine Information zum Versandstatus … wäre wünschenswert », **plainte « On m'a demandé de payer 15 % »** alors que la politique dit 10 %, produit défectueux renvoyé ; un avis cite StockX comme concurrent où « le colis n'est jamais arrivé » (comparaison favorable à Resell).

### 3.2 Interprétation

- Distribution en U typique (85 % de 5★, 5 % de 1★) ; 20 avis 1★ sur 410 = 4,9 % : **fréquence dans l'échantillon d'avis**, pas dans toutes les commandes. Rapportée aux commandes (2 884 en 2026, 6 648 depuis 2022), 410 avis = 6,2 % des commandes totales : **l'échantillon est biaisé** par l'invitation et la non-réponse.
- Thème récurrent : **délai long et manque d'information**, avec une demande explicite d'information sur le statut (allemand). Cela est **cohérent** avec les données internes (promesse 5-10 j.o. vs réel 13 j.o. ; mails supprimés en cas de retard ; 75 % d'e-mails en anglais ; pas d'allemand) mais **ne prouve pas** une causalité.
- La plainte « 15 % » indique soit une erreur d'application (10 % vs 15 %), soit une incompréhension (10 % + frais de retour). **Non vérifiable sans le dossier.**

### 3.3 Distinguer témoignage / échantillon / toutes commandes

| Niveau | Donnée | Limite |
|---|---|---|
| Témoignage | extraits cités (≈ 10) | cas individuels |
| Fréquence dans l'échantillon d'avis | 1★ 4,9 % ; 5★ 84,9 % (410) | auto-sélection ; invitations par Judge.me |
| Fréquence toutes commandes | litiges 32/ ≈ 2 800 ; commandes remboursées 8,8 % ; 97 non expédiées > 14 j. (3,4 % des commandes 2026) | période ≠ avis ; pas de lien nominatif |

### 3.4 Évolution dans le temps

Non mesurée : les dates d'avis Judge.me ne sont pas extraites ; Trustpilot/Google inaccessibles. **À extraire** : export CSV Judge.me (date, note, texte, produit) pour croiser avec les mois de dégradation du sourcing (Sept-Oct).

---

## 4. Plan de réparation de réputation (fondé sur le service)

Principe : **ne pas corriger un problème de service par de la communication**. Ordre :

| # | Action | Mécanisme | Coût | Délai | Mesure |
|---|---|---|---|---|---|
| 1 | Vider le stock des commandes > 14 j. non expédiées (97 cas) : expédier / alternative / remboursement | supprime la source des avis 1★ « jamais reçu » et des litiges | heures de travail + remboursements éventuels | 1-2 semaines | commandes > 14 j. = 0 hors cas décidés |
| 2 | Message proactif de retard (C1, `cx_02`) en FR/DE | réduit la surprise, évite l'avis | faible | 2-3 semaines | contacts par commande ; avis 1-2★ citant « information » |
| 3 | Aligner la promesse de délai (`cx_01` P1) | supprime le motif d'avis « plus long que promis » | dev ≈ 1-2 j. | 2 semaines | écart promesse/réel |
| 4 | Répondre publiquement à chaque avis ≤ 3★ (Judge.me/Trustpilot/Google) en 48 h, sans détail personnel, avec une solution proposée | la réponse est lue par les futurs clients | 15-30 min/semaine | immédiat | taux de réponse ; changement de note après réponse |
| 5 | **Collecte d'avis honnête** : inviter **tous** les clients, au même moment (J+7 après la **livraison** confirmée, pas l'expédition), même texte, sans incitation liée à la note, sans filtrage ; ne pas supprimer ni masquer d'avis, ne pas « acheter » d'avis ; inviter aussi sur Trustpilot (invitation par e-mail de commande) et Google | évite le biais de sélection et la fausse impression ; légal (LCD let. b) | faible | 1 mois | taux de réponse ; part des 1-3★ (attendue : monte au début, puis se stabilise) |
| 6 | Corriger l'affichage : afficher la note et le nombre **de la source** (« 4,7/5 sur 410 avis Judge.me ») au lieu de « 4,9 / 589+ vérifiés » ; ou citer les 4 sources en détail | élimine le risque LCD | 1 heure | immédiat | — |
| 7 | Corriger le portail `/returns` et la FAQ : expliquer « crédit » avant l'acceptation ; frais exacts affichés (10 % + coût retour) ; avertir avant création de l'étiquette | réduit « crédit non traité » et plaintes « 15 % » | dev léger | 2 semaines | litiges crédit ; avis mentionnant les frais |
| 8 | Fixer et publier un délai de réponse réel (heures ouvrables) | confiance | 0 | immédiat | délai de première réponse |

Condition d'arrêt/succès : après 90 jours, part des avis 1-2★ citant « délai / information / frais » < 50 % de la part actuelle (à calculer sur export Judge.me) ; sinon revoir la cause opérationnelle, pas la communication.

---

## 5. Continuité en cas de changement de nom

Le propriétaire de l'activité est une **raison individuelle** (« Solutions Manzinali », IDE CHE-309.864.712). Un changement de nom commercial n'efface ni obligations ni responsabilité. Points à vérifier avec le registre du commerce/juriste (statut d'inscription et modalités **non vérifiés** ici) :

| Domaine | Point de continuité |
|---|---|
| Identité légale | mentions légales, CGV, politique de confidentialité : même titulaire, ancien et nouveau nom visibles pendant une période de transition |
| Commandes en cours | conserver numérotation, accès au suivi, SAV pour toutes les commandes passées sous l'ancien nom ; fenêtre de retour de 14 j. honorée |
| Crédits/avoirs | continuer à les honorer, sans nouvelle date d'expiration |
| Paiement | descripteur de carte et nom du compte Shopify Payments : un changement soudain génère des litiges « fraudulent / non reconnu » ; prévenir 30 jours avant |
| E-mail | domaine d'envoi (SPF/DKIM) et adresse `contact@` conservés ; redirections |
| Avis | Judge.me : l'historique reste sur la boutique ; Trustpilot/Google : un changement de nom est généralement possible sans perdre les avis, mais **ne pas créer un second profil pour repartir à zéro** (pratique trompeuse) |
| Domaine / SEO | redirections 301 complètes, conserver `resell-lausanne.ch` actif |
| SAV | même boîte, mêmes modèles ; message d'information aux clients ayant une commande en cours |
| Marketing | consentements Klaviyo inchangés (pas de nouveau « opt-in » forcé) ; message de transition conforme LCD let. o |

**Confiance : moyenne** — liste de contrôle générale ; aucune vérification juridique ou registre.

---

## 6. Hypothèses

H1 : la clause « colis perdus ou volés non responsable » n'est plus servie (mise à jour du 14 juin). H2 : la note affichée (4,9) provient d'une moyenne manuelle de sources. H3 : la plainte « 15 % » est un cas isolé.

---

## Limites et données manquantes

- Directive UE 2011/83 : texte intégral non lu (EUR-Lex 403) ; règles UE citées via Your Europe et un site de centre européen (Espagne) ; **droits nationaux DE/AT/FR/IT/ES/NL non lus**.
- Avis publics : Trustpilot (note globale) et Google inaccessibles ; Judge.me : un seul instantané sans dates ; extraits < 15, non représentatifs.
- Politiques : deux versions de l'expédition observées ; version réellement servie aux clients non confirmée ; textes complets de la FAQ non lus (429).
- Aucune donnée sur l'effet des frais/crédit sur la conversion ; pas d'accès à la boîte SAV pour mesurer les plaintes sur les frais.
- Qualification juridique (LCD art. 3 al. 1 let. b, art. 8) = lecture d'audit, à faire valider.
- Informations utiles à fournir : export Judge.me complet (date, note, texte) ; accès Trustpilot/Google ; confirmation de la version de politique publiée ; clause contractuelle sur les annulations (si elle existe hors CGV).
