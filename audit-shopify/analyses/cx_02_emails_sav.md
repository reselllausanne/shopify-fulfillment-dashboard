# CX-02 — E-mails transactionnels et SAV (BRIEF §9, §3, §19)

Sous-agent n°2. Lecture seule (Shopify, Postmark, Klaviyo, DB). Aucun e-mail envoyé, aucun réglage modifié. Date : 2026-11-02. Montants en CHF TTC. Aucune donnée nominative (destinataires hachés, notes de remboursement filtrées).

Convention : **Fait** · **Interprétation** · **Hypothèse** · **Reco** · **Confiance**.

---

## 0. Verdict

1. **Aucun échantillon d'échanges SAV réels n'a pu être lu** : aucune boîte Gmail/SAV n'est accessible depuis ce poste (le code `bfcm/holds.ts` mentionne pourtant des libellés Gmail `MARKETING/BLOQUE_SAV`, `Client/En attente retour`, `Salohy/attente retour Theo`, donc une boîte existe). Le SAV est reconstruit à partir de données internes (remboursements, retours, litiges, e-mails Postmark). Toute conclusion sur le *ton* ou la *résolution* des échanges est donc **non vérifiée**.
2. **Langue** : sur 1 335 e-mails clients Postmark récents (19 sept.-2 nov.), **75 % partent en anglais** (1 002 « Order update » vs 333 « Suivi commande »). Les sessions qui finalisent sont 41 % DE, 40 % FR, 14 % EN. Il n'existe **pas de version allemande**. Cause probable : heuristique par domaine d'e-mail (.com → EN, défaut FR).
3. **Le sourcing est la défaillance opérationnelle** ; la communication la rend visible. 40 % de la valeur remboursée (CHF 22,8k) vient d'annulations avant expédition ; **97 commandes payées (CHF 22,6k) sont entièrement non expédiées après 14 jours ou plus** ; 170 si l'on compte les commandes partiellement expédiées.
4. La politique d'expédition promet « informer le Client en cas de retard important connu ». Les mails de retard / annulation-rachat existent en code (`lib/stockxDelayRebuy`) mais leur drapeau est **désactivé par défaut** (état de production non vérifié) ; la seule campagne de retard observée est une excuse de lot (37 mails, 45 j.). Écart entre promesse et pratique : **probable, non démontré**.
5. Retours : **84 % de la valeur remboursée sur retours passe en crédit magasin** (CHF 13,1k sur 15,6k) ; 59 % des motifs de retour sont des tailles. Le crédit n'est pas illégal en Suisse (pas de droit de rétractation) mais produit des litiges « crédit non traité » (10 sur 12 mois, CHF 2,1k).
6. Priorités : (1) traiter nominalement les 97 commandes ; (2) activer, après relecture, un message de retard proactif déclenché par l'âge de la commande ; (3) ajouter l'allemand et corriger la langue ; (4) message de retour reçu / avoir émis ; (5) mesurer les contacts.

---

## 1. Accès et méthode

| Source | Statut | Remarque |
|---|---|---|
| Postmark (API serveur, lecture) | OK | serveur « Shipping update » (id 17936958), flux transactionnel + broadcast ; stats depuis 2026-01-28 ; métadonnées messages sur 45 j. (rétention) |
| Klaviyo (API lecture) | OK | voir `cx_04` |
| DB `StockxOrderAlert`, `OrderMatch`, `StockXStatusEvent`, `ShopifyFulfillmentRecord` | OK (SELECT) | `ShopifyFulfillmentRecord` incomplet (2 098 enregistrements depuis 2026-01-21) → non utilisé pour les parts d'expédition |
| Shopify Admin API (commandes, remboursements, retours, événements) | OK | `orders_api.ndjson` complet (6 650 commandes, #1001 → #7658) |
| Modèles de notifications Shopify (confirmation, expédition natif) | **KO** | non exposés par l'API ; contenu **non lu** |
| Boîte Gmail / SAV | **KO** | aucune boîte identifiée ou accessible |
| Notes de commande / commentaires staff | partiel | seuls 4 commentaires staff dans la timeline 2026 ; 311 remboursements dont 197 sans note |
| Avis publics | partiel | voir `cx_03` |

Sécurité : le jeton Postmark est apparu une fois dans une sortie d'outil ; il n'est reproduit nulle part. À considérer comme exposé dans le journal de session : le renouveler est prudent.

---

## 2. Cartographie des étapes e-mail

Périmètre : événements Shopify (fenêtre ≈ mi-août → 2 nov., 1 078 commandes), Postmark (45 j.), code (`app/lib/mailer/postmark.ts`, `app/lib/notifications/*`, `lib/stockxDelayRebuy/*`).

| Étape | Existe ? | Canal / déclencheur | Constat (Fait) | Évaluation |
|---|---|---|---|---|
| Confirmation de commande | Oui | Shopify natif ; délai médian **2 s** après la commande, présent sur 100 % de la fenêtre | contenu non lisible | conforme à l'exigence d'une confirmation sans délai (LCD art. 3 al. 1 let. s) ; **promesse de délai du mail inconnue** |
| « Achat confirmé » (sourcing) | Oui | Postmark `PURCHASE_CONFIRMED` / `EXPRESS_CONFIRMED` après achat fournisseur | volumes mensuels 2026 : 140 (janv.) → 1 478 (oct.) tous types confondus ; erreurs d'envoi ≈ 29 sur ce jalon en janvier, proches de 0 depuis mars | bon principe ; le client n'apprend l'achat qu'après le délai de sourcing (médiane 107 h en sept.) |
| Étapes fournisseur | Oui | `SELLER_SHIPPED_TO_STOCKX`, `STOCKX_VERIFIED_AND_SHIPPED`, `DELIVERED_TO_SWISS_DISTRIBUTOR` | mails sautés si l'ETA est dépassée ou la commande expédiée | la règle « ETA dépassée → pas de mail » **supprime l'information au moment où le client en a le plus besoin** (interprétation) |
| Achat impossible / recherche d'un autre vendeur | Code oui, usage non démontré | `lib/stockxDelayRebuy` (SUPPLIER_CHANGE_DELAY, CANCEL_REBUY_LEGIT…) ; drapeaux `STOCKX_CUSTOMER_DELAY_MAIL…` OFF par défaut ; max 5 mails par exécution | seuls des mails `[TEST]` / `[PREVIEW CLIENT]` dans la fenêtre Postmark | état production **non vérifié** (accès VPS non utilisé) |
| Retard | Partiel | mail « Retard sur ta commande #N — nous sommes désolés » (tag `warehouse-counterfeit-lot-apology`) : **37 envois** dans les 45 j. | excuse liée à un lot précis, pas à un déclencheur d'âge | pas de relance générale pour les 97 commandes bloquées |
| Expédition | Oui, deux émetteurs | Swiss Post Labels (459 événements « confirmation d'expédition ») et ALLIN-ONE (534) + Postmark `CUSTOMER_SHIPPED_LA_POSTE` | possible **double e-mail d'expédition** (deux apps) ; non quantifié | à vérifier : même commande, deux messages ? |
| En cours de livraison / Livré | Oui | Swiss Post Labels : 371 « out for delivery », 434 « delivered » | mail « delivered » présent pour **327 des 844 commandes expédiées** de la fenêtre (39 %) | le mail livré n'est pas fiable comme preuve de livraison |
| Retour (instructions, étiquette) | Oui | portail `/returns` (FR/EN/DE) + e-mail ALLIN-ONE | portail trilingue ; chaîne e-mail ensuite FR/EN | OK structurellement |
| Échange | Partiel | via retour + crédit | pas de flux d'échange direct mesuré | — |
| Annulation / remboursement | Shopify natif | notes de remboursement : « order canceled » 44 ; retards 12 ; etc. | contenu du mail non lu | à auditer avec les modèles Shopify |
| Avoir / crédit magasin | Shopify natif | 66 retours remboursés en crédit (CHF 13,1k) en 2026 | **31** commandes ont ensuite payé en crédit (CHF 6,2k) | voir §4.3 |
| Demande d'avis | Judge.me | 423 avis (voir `cx_03`) | délai d'envoi non lu | à vérifier |

Mails internes dans Postmark : alertes d'exploitation vers le dirigeant (« StockX token DEAD » ×288, récapitulatifs de backlog). Elles polluent la lecture de la délivrabilité (flux « Shipping update » partagé) ; elles ne sont pas des mails clients.

Statistiques Postmark globales (janv. 28 → nov. 2) : 6 488 envoyés, 49 rebonds (0,76 %), 0 spam. Aucun problème de délivrabilité visible.

### 2.1 Langue : preuve

Fait : sur 1 335 messages clients (45 j.), 1 002 « Order update » (EN) et 333 « Suivi commande » (FR). Code `detectLanguage` : TLD de l'e-mail (.com/.net/.org/.uk/.us → EN ; .fr/.be/.ch/.qc → FR ; défaut FR). Seul FR/EN existent.
Fait : sessions finalisées (pixel) 18-oct → 2-nov : locale DE 42, FR 41, EN 14, IT 3.
Interprétation : un client suisse avec une adresse `@gmail.com` reçoit un e-mail anglais ; un client alémanique n'a aucune version allemande. **Hypothèse** (non prouvée) : la part d'e-mails en anglais gonfle les contacts « où est ma commande » et dégrade la confiance. Confiance sur le fait : **haute** ; sur l'effet : **faible**.

---

## 3. Silences, délais réels et dépendance au dirigeant

### 3.1 Fait — âge des commandes payées non expédiées (statuts API Shopify au 2 nov.)

| Âge (jours) | Commandes payées non (entièrement) expédiées, non annulées |
|---|---|
| ≤ 3 | 12 |
| 4-7 | 29 |
| 8-10 | 21 |
| 11-14 | 23 |
| 15-21 | 23 |
| 22-30 | 24 |
| 31-60 | 50 |
| > 60 | 73 |

Total > 14 jours : 170 (CHF 49,4k brut). Dont **97 entièrement non expédiées (UNFULFILLED)** : CHF 22,6k brut, CHF 1,9k déjà remboursés. Par mois de commande : sept. 33, oct. 43, août 9, antérieur 12. Rapprochement DB : aucune de ces 97 n'a d'enregistrement d'expédition ; 42 ont un achat StockX lié ; 8 ont une annulation côté StockX. Script : `calculs/cx_02_stats.py`.

Limites : (1) les 39 commandes « partiellement expédiées » ont souvent une ligne « protection colis » non expédiable → à retirer du compte (artefact probable) ; (2) un statut Shopify « non expédié » peut cacher un envoi hors Shopify (à confirmer commande par commande) ; (3) certaines commandes sont peut-être des cas connus (fraude `scam`, réservations).

### 3.2 Fait — délais de résolution observés

Commande → remboursement (transactions 2026, médiane/P90, jours) : annulations 8,8 / 29,1 (n = 51) ; retours 27,8 / 54,9 (n = 84) ; autres remboursements 22,2 / 48,8 (n = 127). Cela inclut le délai de retour physique pour les retours ; **il ne mesure pas le délai de traitement après réception** (non extractible).

### 3.3 Dépendance au dirigeant

Fait : alertes d'exploitation envoyées au dirigeant ; mails de retard/annulation soumis à drapeau manuel et plafond de 5 envois par exécution ; boîte avec libellé « attente retour Theo ». Interprétation : le traitement des cas non standard dépend d'une personne. **Hypothèse** (non mesurée) : les délais de réponse varient avec sa disponibilité. À mesurer sur la boîte SAV.

### 3.4 Texte standard : informations données au client

Code `postmark.ts` : les mails de statut donnent une date estimée et la consigne « Si rien n'est livré 48h après cette date, contacte-nous ». Interprétation : la charge de la relance est reportée sur le client, et la date estimée n'est mise à jour que si une règle de retard s'applique. Le ton est tutoyant, court, sans mention du fournisseur (volontaire).

---

## 4. Fréquences de SAV (toutes commandes 2026, pas seulement les cas bruyants)

Périmètre : janv.-oct. 2026, 2 884 commandes non annulées (+ 51 annulées), orders_api. Scripts `cx_02_stats.py`, `cx_02_refunds.py`, `cx_02_refund_types.py`.

### 4.1 Fait

| Indicateur | Valeur |
|---|---|
| Commandes annulées | 51 (1,8 %) ; motifs API : client 46, autre 3, stock 2 |
| Commandes entièrement remboursées | 142 (4,9 %) |
| Commandes partiellement remboursées | 113 (3,9 %) |
| Commandes avec objet « Return » Shopify | 139 (4,8 %) ; 145 objets ; statuts clos 102, ouverts 35, annulés 5 |
| Total remboursé | **CHF 57,8k = 8,3 % du brut** (CHF 698k) |
| Remboursements en crédit magasin | CHF 13,4k = 23,2 % du remboursé ; **84 % de la valeur des remboursements sur retours** |
| Remboursements par nature | retours physiques 122 / CHF 19,7k (34 %) ; annulations avant expédition 93 / CHF 22,8k (40 %) ; autres lignes remboursées sans retour ni annulation 95 / CHF 15,1k (26 %) |
| Notes de remboursement (311) | sans note 197 ; annulation 68 ; retard/non expédié 24 ; indisponible/achat impossible 5 ; écart express/standard 6 ; autre 11 |
| Motifs de retour (154 lignes) | taille trop petite 70 + trop grande 21 = **91 (59 %)** ; autre 28 ; inconnu 18 ; non voulu 5 ; style 4 ; couleur 3 ; non conforme 3 ; mauvais article 2 |
| Litiges de paiement nov. 2025-oct. 2026 | 32 (CHF 8,4k) : frauduleux 13 (4,6k, 13 perdus) ; crédit non traité 10 (2,1k, 6 gagnés/4 perdus) ; produit non reçu 8 (1,5k, 6 perdus, 1 gagné, 1 accepté) ; produit inacceptable 1 |
| Mensuel : taux de commandes remboursées totalement | 2,5 % (mai) à 7,8 % (févr.) ; octobre 4,6 % |

Tables : `tableaux/cx_02_sav_mensuel.csv`, `cx_02_remboursements_par_moyen.csv`, `cx_02_remboursements_buckets.csv`, `cx_02_remboursements_nature.csv`, `cx_02_refund_notes.csv`, `cx_03_litiges_motifs.csv`.

### 4.2 Interprétation

- **Le « retour » est minoritaire** dans la valeur remboursée (34 %). La majorité (66 %) correspond à des commandes annulées avant expédition ou à des remboursements sans retour ni annulation : problème d'approvisionnement/disponibilité plutôt que de politique de retour.
- Les retours sont des problèmes de **taille** à 59 % : le levier est l'aide au choix de taille (guide, historique de taille, e-mail pré-livraison), pas l'ajustement des frais.
- 95 remboursements (CHF 15,1k, 26 %) restent sans explication dans les données : **à investiguer avec la boîte SAV** (hypothèse : lignes d'une commande multi-articles non achetables, retours traités hors module Retours, gestes commerciaux).
- Les litiges « produit non reçu » (8) et « crédit non traité » (10) sont les seuls liés au service (18/32 = 56 % des litiges, CHF 3,6k) ; les 13 litiges « frauduleux » (CHF 4,6k) relèvent de l'anti-fraude.

### 4.3 Crédit magasin : usage réel

Fait : crédits émis en 2026 via remboursements : CHF 13,4k (66 transactions sur retours + 2 autres). Crédit utilisé sur commandes 2026 : 31 commandes, CHF 6,2k (comparaison approximative : des crédits émis en 2025 peuvent avoir été consommés en 2026, non extrait). Interprétation : **moins de la moitié du crédit émis est reconverti en ventes sur la même période** ; le crédit n'est donc pas une rétention forte à court terme. Hypothèse : une partie des clients le perçoit comme une perte et contacte leur banque (« crédit non traité »). **Confiance : moyenne** (période et périmètre non appariés).

### 4.4 Coût du SAV

Non mesurable : pas de boîte SAV, pas de temps passé. Ordre de grandeur indicatif de la valeur remboursée par des annulations avant expédition : CHF 22,8k TTC sur 10 mois ; marge perdue approximative = contribution moyenne CHF 30,6 par commande × 51 annulations ≈ CHF 1,6k, plus les litiges perdus (≈ CHF 6-7k incluant fraudes) et les frais fixes de litige (non extraits). Cela **ne comprend pas** le coût de l'achat publicitaire des commandes annulées (non attribuable proprement).

---

## 5. Mauvaise communication ou défaillance opérationnelle ?

| Symptôme | Nature | Preuve | Remède principal |
|---|---|---|---|
| Commande payée, rien depuis > 14 j. | **Opérationnelle** (sourcing/expédition) ; aggravée par le silence | 97 commandes, 42 avec achat lié | décider cas par cas ; ne pas « mieux écrire » seulement |
| Délai affiché 2-5 / 5-10 j.o. vs réel 10-13 j.o. | **Promesse** impossible à tenir | `cx_01` §2 | aligner la promesse ; aucun texte ne compense |
| Mail en anglais pour un client suisse FR/DE | **Communication** | 75 % EN | langue par locale + DE |
| Crédit refusé comme remboursement initial | **Politique** (légale en CH, coûteuse en litiges) | 10 « crédit non traité » | message explicite + moment du crédit ; option de remboursement dans certains cas |
| Date estimée dépassée → mail supprimé | **Communication** (règle de code) | `stockxEmail.ts` | envoyer un mail « retard » au lieu de se taire |
| Annulation par fournisseur → remboursement 9 j. médiane | **Opérationnelle** | 8,8 j. | automatiser notification + remboursement |

---

## 6. Communications prioritaires (spécification)

Principe : un message de service **ne contient pas de promotion** (séparation §10). Tous les textes ci-dessous sont des **propositions** à relire (juridique/ton) avant activation ; aucune n'est envoyée. Variables entre `{}`.

### C1 — Retard détecté (déclenché par l'âge)

| Champ | Contenu |
|---|---|
| Déclencheur | Commande payée, non annulée, non expédiée, âge > P90 de la promesse affichée (ex. 14 j. calendaires en Standard, 10 en Express) ; un seul envoi puis relance à +7 j. si toujours non expédiée. Exclure les commandes `scam`, litige ouvert ou décision manuelle. |
| Problème actuel | Silence ; le client contacte ou ouvre un litige (8 « non reçu »). |
| Texte FR | Objet : « Ta commande #{n} : où en est-elle ». Corps : « Bonjour {prénom}, ta commande #{n} ({article}, taille {taille}) n'est pas encore expédiée. C'est plus long que prévu ; l'article est en cours de sourcing auprès de notre fournisseur. Prochaine information d'ici le {date+5 j.o.}. Tu peux : attendre (rien à faire), ou annuler et être remboursé sur ton moyen de paiement initial : réponds à ce mail avec « annuler ». Si tu préfères un autre article équivalent, dis-le-nous. » |
| Texte DE | « Hallo {Vorname}, deine Bestellung #{n} ({Artikel}, Grösse {Grösse}) wurde noch nicht versendet. Das dauert länger als angegeben. Nächstes Update bis {Datum}. Du kannst warten oder die Bestellung stornieren und den Betrag auf dein ursprüngliches Zahlungsmittel zurückerhalten : antworte mit « stornieren ». » |
| Données | statut Shopify, date de commande, article/taille, date du dernier événement fournisseur, drapeau litige. |
| Responsable | automatisé ; exceptions revues par la personne SAV désignée (pas le dirigeant seul). |
| Escalade | pas de réponse du client à J+14 après le 2ᵉ envoi → ne rien faire d'automatique ; réponse « annuler » → remboursement sous 3 jours ouvrés ; plainte/avis négatif → dirigeant. |
| Mesure | contacts par commande avec C1 vs sans ; litiges « non reçu » ; taux de réponse « annuler » ; remboursements ; avis. |
| Effet attendu | moins de litiges et d'avis négatifs ; plus d'annulations explicites (revenu perdu, mais moindre coût que litige/avis). Incertain. |

### C2 — Achat impossible / changement de fournisseur

| Déclencheur | Alerte d'achat impossible (`CANCELLED`, `NOT_PURCHASED`) ou fournisseur de substitution choisi |
| Problème | Annulation ou rachat sans information claire ; la lib existe mais flag OFF (état prod inconnu). |
| Texte FR | « Bonjour {prénom}, nous n'avons pas pu obtenir ton article dans la taille et l'état attendus. Choix : (1) nous cherchons une autre source (délai supplémentaire estimé {X} jours ouvrés), (2) remboursement intégral sous 3 jours ouvrés. Réponds « 1 » ou « 2 ». Sans réponse sous 5 jours ouvrés, nous poursuivons la recherche si tu n'as pas indiqué autre chose. » |
| Données | commande, ligne, motif, prix de l'alternative, ETA. |
| Responsable | automatisé ; décision prix/alternative par l'acheteur. |
| Escalade | alternative plus chère que le prix payé → décision humaine, jamais supplément automatique. |
| Mesure | taux de choix 1/2, délai de résolution, litiges. |
| Effet | clarté ; la lib applique déjà « jamais mentionner le fournisseur » — conserver. |

### C3 — Retour reçu / avoir ou remboursement émis

| Déclencheur | Statut Return « reçu » puis émission avoir/remboursement. |
| Problème | Aucun mail dédié lu ; litiges « crédit non traité » (10). |
| Texte FR | « Nous avons reçu ton retour (commande #{n}). Après contrôle, ton avoir de CHF {montant} (frais de traitement de 10 % déduits : CHF {frais}) est disponible dans ton compte sous le code {code}. Valable jusqu'au {date}. » |
| Données | montant, frais, validité du crédit (la politique ne la fixe pas : **à définir**). |
| Responsable | automatisé ; contrôle humain avant émission. |
| Escalade | contestation → humain sous 2 jours ouvrés. |
| Mesure | litiges « crédit non traité », contacts « où est mon avoir ». |
| Effet | réduction des litiges ; transparence des frais. |

### C4 — Confirmation de commande avec délai vrai

Reprise du texte de confirmation Shopify (non lu) pour y insérer la fourchette unique du §P1 de `cx_01`, et une phrase : « Tu recevras un e-mail à chaque étape ; si ta commande dépasse {P90} jours ouvrés, nous t'écrirons ». Responsable : thème/notification Shopify (modèle à lire avant modification). Mesure : contacts par commande.

### C5 — Commande hors parcours normal

Cas : double achat par erreur (« une paire vendue à double »), produit introuvable, prix impossible, retrait en boutique (Rare Bienne/Antica Bottegas), commande internationale. Règle : un seul cas = un statut Shopify (tag) + un modèle de message FR/DE/EN ; le client reçoit toujours le choix « attendre / alternative / remboursement » ; remboursement sous 3 jours ouvrés pour annulation fournisseur.

---

## 7. Prévention, automatisation, seuils, délégation

- **Prévention** : chaque promesse affichée aligné sur la médiane+P90 ; contrôler la disponibilité fournisseur avant l'encaissement pour les 10-20 modèles les plus vendus (non étudié ici) ; vérification d'adresse.
- **Automatisation** : C1 et C2 déclenchées par l'âge/statut, pas par lot ; supprimer la règle « ETA dépassée → pas de mail ».
- **Seuils de remplacement** (à valider avec la marge) : si l'alternative coûte ≤ 5 % de plus et même état → proposer ; si plus → remboursement proposé. Seuils **proposés, non issus de données** ; à calibrer sur 30 cas.
- **Escalade** : tout message client contenant « litige », « banque », « plainte », « avocat », « avis » → file prioritaire ; si un litige est ouvert, **exclure la personne du marketing** (cohérent avec `bfcm/holds.ts`).
- **Délégation** : désigner une personne SAV (le code évoque déjà une autre personne), avec 2-3 modèles et un budget de geste commercial plafonné (par ex. CHF 20/commande) à définir par le dirigeant.
- **Doublon d'expédition** : n'utiliser qu'un émetteur de mail d'expédition (Swiss Post Labels **ou** ALLIN-ONE **ou** Postmark) après vérification d'un cas réel.

---

## 8. Mesures à instaurer

1. Contacts par commande et par motif (boîte SAV étiquetée) — **inexistant à ce jour**.
2. Délai de première réponse et de résolution ; taux de réouverture.
3. Commandes > 14 j. non expédiées (compteur quotidien) ; cible 0 sauf cas décidés.
4. Part des e-mails par langue et par locale de commande.
5. Litiges par motif (mensuel).

## 9. Hypothèses et incertitudes

H1 : une partie des 97 commandes est déjà gérée hors Shopify. H2 : les remboursements « NO_RESTOCK sans retour » viennent de lignes jamais achetées. H3 : l'anglais dégrade la confiance. **Confiance globale du dossier : moyenne** — comptages API fiables, absence d'échanges réels.

---

## Limites et données manquantes

- **Aucun échange SAV réel lu** (pas de Gmail/Helpdesk) ; fréquence de contacts, ton, réponses, réouvertures : non mesurés.
- Modèles de notification Shopify non lus (confirmation, annulation, remboursement, avoir, expédition native).
- Événements Shopify disponibles seulement depuis ≈ mi-août ; délais de livraison fondés sur le mail « delivered » (39 % de couverture).
- `ShopifyFulfillmentRecord` incomplet (2 098) ; états d'expédition = API Shopify.
- Mails Postmark : fenêtre de 45 jours ; les destinataires sont hachés ; les envois Klaviyo ne sont pas dans ce périmètre.
- État réel du drapeau `STOCKX_CUSTOMER_DELAY_MAIL` en production non vérifié.
- Demandes d'information **nécessaires** : (1) export (ou accès lecture) de la boîte SAV sur 90 jours ; (2) copie des modèles de notification Shopify ; (3) confirmation que les 97 commandes sont réellement non expédiées ; (4) valeur des drapeaux de mails de retard en production.
