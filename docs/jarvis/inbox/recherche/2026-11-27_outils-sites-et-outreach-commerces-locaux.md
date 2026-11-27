# Outils pour sites vitrines TPE + méthode de démarchage email B2B (Lausanne)

Date de consultation de toutes les sources : **2026-11-27** (date de la source indiquée quand elle est visible ; « date non visible » sinon).
Statut : recherche web seule, lecture seule. Aucun contact réel avec un commerce, aucun email envoyé, aucun compte créé, aucun outil testé. Aucun code modifié.
**Ce document n'est pas un avis juridique.** Décision de suite : Théo.

Contexte (profil cible, d'après la PR #564, `docs/jarvis/inbox/recherche/2026-11-27_commerces-sans-site-lausanne.md`, non modifié) : 10 commerces « confirmés » sans site propre autour de Lausanne : couture/retouches, institut de beauté, 2 studios de tatouage, salon de coiffure, 2 épiceries, maçonnerie, carrosserie, barbier. Profil TPE / indépendant, fiche Google Maps (souvent non revendiquée), parfois réservation tierce (Salonkee, Fresha). Aucun commerce n'est nommé ici et aucune donnée de contact n'est reprise.

Légende de fiabilité : **[officiel]** = page du fournisseur / texte de loi / autorité. **[secondaire]** = blog, comparateur, cabinet ou agence (souvent avec intérêt commercial). **[incertain]** = donnée non confirmée par une source primaire, ou source unique, ou benchmark générique.

## 0. Taux de change utilisé

Source : BCE, taux de référence du **2026-11-27** [officiel] : <https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html>.
1 EUR = 0,9157 CHF ; 1 EUR = 1,0957 USD → **1 USD = 0,8357 CHF** (calcul : 0,9157 / 1,0957). Conversions arrondies au centime ; taux indicatif (la BCE déconseille de l'utiliser pour des transactions). Pas de TVA ajoutée sauf mention. TVA suisse normale 8,1 % (indiquée par [secondaire] webtesten.ch et patrykochman.com ; non revérifiée sur l'AFC).

---

# Question 1 : meilleur outil pour sites vitrines de TPE locales

## 1.1 Trois options comparées

- **Option A : service clé en main suisse** (builder + hébergement + domaine + email chez un fournisseur suisse) : Hostpoint « Sites », Infomaniak « Site Creator ».
- **Option B : stack code réutilisable** : Next.js (export statique) + template maison, hébergé sur hébergement suisse mutualisé (ou autre).
- **Option C : builder no-code international** : Framer, Webflow, Wix, Jimdo, Hostinger.

## 1.2 Prix publics relevés (devise d'origine → CHF)

| Offre | Prix affiché (devise d'origine) | ≈ CHF / mois | Remarques | Fiabilité / source |
|---|---|---|---|---|
| Hostpoint Sites Basic (5 pages) | CHF 9.00 / mois | 9.00 | domaine propre, 1 email perso, support 7j/7, hébergement en datacenter suisse. TVA : non précisée sur la page Sites (la page Domaines dit « TVA incluse ») | [officiel] <https://www.hostpoint.ch/en/website/> (date non visible) |
| Hostpoint Sites Plus (250 pages) | CHF 15.00 / mois | 15.00 | idem | [officiel] même page |
| Hostpoint : email Cloud Office Basic | gratuit pendant le 1er terme du contrat, puis CHF 3.00 / mois | 3.00 | | [officiel] même page |
| Hostpoint : domaine .ch | CHF 5.00 la 1re année, puis CHF 15.00 / an (TVA incluse) | 1.25 / mois (renouv.) | | [officiel] <https://www.hostpoint.ch/en/domains/> |
| Infomaniak Site Creator Lite (6 pages, 15 Go, domaine offert 1 an, engagement ferme 12 mois sans remboursement) | CHF 1.95 / mois HT en promo sur 48 mois (CHF 93.60), tarif plein CHF 3.90 / mois HT (CHF 187.20 / 48 mois) ; 1 an : CHF 3.15 / mois HT promo | 2.11 TTC promo ; 4.22 TTC plein | pas d'export du site (verrouillage) | description des plans et engagement : [officiel] <https://www.infomaniak.com/fr/support/faq/2518/decouvrir-les-differentes-formules-site-creator> ; **montants en CHF : [secondaire]** (la page tarifs officielle n'a pas rendu les prix à la lecture : <https://www.infomaniak.com/fr/creer-un-site/site-creator/tarifs>) via <https://vagar.ch/avis/infomaniak-site-creator> (2026-10-29), <https://webtesten.ch/testberichte/infomaniak-site-creator-avis/> (vérifié 2026-08-20), <https://patrykochman.com/prix-site-internet-suisse/> (2026-08-26) |
| Infomaniak : email Service Mail / kSuite Standard | dès CHF 2.29 / mois (Service Mail) ; kSuite Standard CHF 1.76 / utilisateur / mois | 1.76 à 2.29 | email hébergé en Suisse, domaine propre | [officiel] <https://www.infomaniak.com/fr/ksuite/service-mail/tarifs> (date non visible ; HT/TTC non précisé sur l'extrait lu → [incertain]) |
| Infomaniak : domaine .ch | CHF 4.64 la 1re année, puis CHF 9.89 / an HT | 0.82 / mois (renouv. HT) ; TTC 10.69 / an calculé | | [secondaire] <https://webtesten.ch/testberichte/infomaniak-erfahrungen/> (vérifié 2026-08-19) ; confirmé par patrykochman.com et <https://www.0ggi.ch/de/blog/was-kostet-eine-website-pro-monat> (2026-10-23, maj 2026-11-21). Un autre blog donne CHF 12.00 (<https://webhostingvergleich24.ch/ch-vs-swiss-domain>, nov. 2026) : **divergence → [incertain]** |
| Framer Basic / Pro | USD 10 / USD 30 par mois (facturation annuelle, taxes en plus) | 8.36 / 25.07 | domaine custom gratuit la 1re année (extensions non précisées ; .ch non confirmé) ; pas de mention d'hébergement en Suisse | [officiel] <https://www.framer.com/pricing> |
| Webflow Basic / Premium (CMS) | USD 15 / USD 25 par mois par site (annuel), taxes en plus | 12.54 / 20.89 | tarifs de mai 2026 ; Basic sans CMS, 300 pages statiques, 10 Go de bande passante | [officiel] <https://webflow.com/pricing> et <https://help.webflow.com/hc/en-us/articles/51059955082387-Updated-pricing-and-simplified-plans-for-May-2026> (maj 2026-08-31) |
| Wix Light / Core / Business | EUR 14 / 25 / 34 par mois (annuel, hors taxes, vus depuis la Suisse) | 12.82 / 22.89 / 31.13 | Wix n'affiche pas de CHF officiel ; page officielle lue en USD « avec GST » (non exploitable) | **[secondaire]** <https://blitzweb.ch/vergleich/wix> (relevé 2026-11-09), <https://www.maltconsulting.ch/webflow-vs-wix> (2026-10-28), <https://jeremylecca.ch/websites/wix-oder-webdesigner> (maj 2026-11-14). Autre source en EUR TTC (16,80 / 30 / 40,80) : <https://helvesite.ch/blog/wix-ou-agence-web-suisse/> (2026-11-15) |
| Jimdo Start / Grow | USD 11 / USD 17 par mois (12 mois d'avance, TVA incluse selon la page) | 9.19 / 14.21 | domaine .ch compris dans l'offre « 1er terme gratuit » ; hébergement UE ; support Start : réponse sous 2 jours ouvrés. Une source suisse donnait CHF 24 / 32 en août (ancienne grille ?) → **[incertain]** | [officiel] <https://www.jimdo.com/pricing/> ; [secondaire] patrykochman.com |
| Hostinger Website Builder Premium | USD 1.99 / mois en promo (USD 95.52 payés d'avance pour 48 mois), renouvellement USD 10.99 / mois | 1.66 promo (79.83 pour 48 mois) ; 9.18 au renouvellement | domaine et 2 emails gratuits 1 an ; promo « Black Friday » ; pas de datacenter en Suisse selon [secondaire] | [officiel] <https://www.hostinger.com/website-builder> (offre Black Friday, `priceValidUntil` 2027-11-27 dans le schéma de la page) ; localisation : [secondaire] <https://helvesite.ch/blog/hebergeur-web-suisse-infomaniak-hostpoint-hostinger/> (2026-11-15) |
| Vercel Pro (pour option B si hébergé là) | USD 20 / mois | 16.71 | Hobby gratuit ; **aucune région en Suisse** (plus proches : Francfort, Paris). Règles d'usage commercial du plan Hobby : non vérifiées → **[incertain]**, lire les CGU | [officiel] <https://vercel.com/pricing>, <https://vercel.com/docs/regions> |

Autres repères d'hébergement suisse (option B) : Infomaniak Hébergement Web dès CHF 10.91 / mois HT (20 sites, serveurs en Suisse) [officiel, extrait de la page produit lu via recherche : <https://www.infomaniak.com/fr/creer-un-site/site-creator>] ; Hostpoint Web Standard CHF 15.90 / mois TTC [secondaire : <https://helvesite.ch/blog/hebergeur-web-suisse-infomaniak-hostpoint-hostinger/>] ; MaxiHoster dès CHF 4.90 / mois, datacenter suisse [secondaire : patrykochman.com].

## 1.3 Tableau comparatif par critère

| Critère | A. Clé en main suisse (Hostpoint Sites / Infomaniak Site Creator) | B. Next.js statique + template + hébergement suisse | C. No-code international (Framer, Webflow, Wix, Jimdo, Hostinger) |
|---|---|---|---|
| Rapidité de mise en prod | Hostpoint : « quelques heures » pour un petit site (FAQ officielle) ; 100+ modèles | Premier site : lent (construire le template). Ensuite : **estimation interne non sourcée [incertain]** de quelques heures par site | Rapide (templates), mais chaque builder a sa courbe d'apprentissage ; Jimdo génère un site par IA |
| Coût CHF (récurrent, 1 site, 5 pages, domaine, 1 email) | Hostpoint : 108 (Basic) + 5 (domaine an 1) = **≈ 113 / an en an 1** ; puis 108 + 15 + 36 (email) = **≈ 159 / an**. Infomaniak Lite : ≈ 38 HT en an 1 promo (12 mois) ; puis ≈ 47 + 10 + 21 (kSuite) = **≈ 78 HT / an** (calculs maison sur prix ci-dessus) | Hébergement 59 (MaxiHoster Start) à 131 HT (Infomaniak) + domaine 5 à 10 + email ≈ 21 = **≈ 85 à 160 / an** (calcul maison, hébergement mutualisable entre clients). Pas de licence | USD/EUR : Framer Basic ≈ 100 / an ; Webflow Basic ≈ 150 / an ; Wix Light ≈ 154 / an ; Jimdo Start ≈ 110 / an (+ domaine, + email non inclus selon l'offre). Hostinger : intro très basse, renouvellement ×5 |
| Maintenance par le commerçant | **Oui** : éditeur glisser-déposer, support tél. 7j/7 (Hostpoint) | **Non sans CMS** : nous maintenons (contenu dans un fichier JSON/MDX) ou on ajoute un CMS headless (surcoût) | Oui, avec courbe d'apprentissage ; Webflow/Framer plus « designer » que « commerçant » |
| Maintenance par nous | Possible (accès client), mais pas de réutilisation de code | **Forte** : template unique, correctifs partagés, Git | Faible réutilisation ; certains offrent des modes « Expert / agence » (Framer, Webflow) |
| Propriété / sortie | Infomaniak Site Creator : **pas d'export** ([secondaire] vagar.ch, webtesten.ch). Hostpoint : migration entrante gratuite ; sortie : non précisée → [incertain] | **Totale** (code + domaine au nom du client) | Verrouillage plateforme (Hostinger : site non exportable vers WordPress, [secondaire] <https://bearhost.com/blogs/hostinger-pricing>, 2026-10-26) ; Framer/Webflow : export limité, non vérifié → [incertain] |
| Domaine .ch + email pro suisse | .ch en un clic ; email suisse inclus la 1re année (Hostpoint) / à CHF 1.76-2.29 (Infomaniak) | Domaine chez Hostpoint/Infomaniak ; email hébergé en Suisse (Infomaniak kSuite / Hostpoint Cloud Office) | .ch pas toujours proposé ou pas gratuit (Jimdo : oui, offert 1er terme ; Wix/Framer/Webflow : .ch non confirmé) ; email = Google Workspace (Wix) ou externe |
| SEO local de base | Réglages SEO limités au builder ; Hostpoint propose rankingCoach ; **schema LocalBusiness : non mentionné sur les pages lues** → [incertain] | **JSON-LD LocalBusiness sur mesure**, sitemap, performance, tout est sous contrôle (voir 1.4) | Jimdo : réglages SEO par page, FAQ structurée, Search Console connectée, add-on « Listings Management » ([officiel] jimdo.com/pricing). Framer Basic : « SEO intégré ». Injection de JSON-LD personnalisé : **non vérifiée** pour chaque builder |
| Hébergement / localisation des données | **Suisse** (Hostpoint : datacenter suisse ; Infomaniak : données en Suisse, [secondaire] webtesten.ch) | Au choix : Suisse (hébergeur suisse) ; Vercel = pas de région suisse | Jimdo : UE (page officielle). Wix : « multi-cloud », lieu non précisé. Framer / Webflow : lieu non précisé sur les pages lues. Hostinger : pas de datacenter suisse ([secondaire]) → **[incertain] pour la nLPD** |

## 1.4 SEO local : ce qui est vérifié

- Fiche d'établissement Google : création et revendication **gratuites** ; une fiche non validée existante peut être revendiquée via « Revendiquer cet établissement » ([officiel] <https://support.google.com/business/answer/2911778?hl=fr>, date non visible). Cohérent avec le rapport #564 : plusieurs fiches ciblées sont « non revendiquées ».
- Données structurées `LocalBusiness` : propriétés **obligatoires** `name` et `address` ; **recommandées** `geo`, `openingHoursSpecification`, `telephone`, `url`, `priceRange` ; utiliser le sous-type le plus précis ; Google ne garantit pas l'affichage ([officiel] <https://developers.google.com/search/docs/appearance/structured-data/local-business>, dernière mise à jour 2026-09-08).
- Next.js : l'export statique produit des fichiers HTML/CSS/JS servables par n'importe quel serveur statique ; l'optimisation d'images par défaut, les Server Actions, etc. ne sont pas disponibles en mode statique ([officiel] <https://nextjs.org/docs/app/guides/static-exports>). Compatible avec un hébergement mutualisé suisse.

## 1.5 Recommandation finale (5 lignes)

1. **Choix principal : option B** (template Next.js statique, contenu en un fichier, JSON-LD `LocalBusiness`, hébergement suisse, domaine et email au nom du client) : coût marginal faible, propriété claire, SEO local maîtrisé, réutilisable sur les 10 cibles et au-delà.
2. **Variante A (Hostpoint Sites Basic, CHF 9 / mois)** si le commerçant veut éditer lui-même ou si on veut livrer en une demi-journée sans maintenance : données en Suisse, .ch et email inclus.
3. **Éviter C** pour ce public : facturation USD/EUR, .ch et localisation des données non garantis, verrouillage, prix d'appel qui explosent au renouvellement (Hostinger).
4. Dans tous les cas : domaine au nom du commerçant, fiche Google revendiquée, schéma `LocalBusiness`, lien vers la réservation tierce existante (Salonkee, Fresha) plutôt que la remplacer.
5. À valider avant de s'engager : temps réel par site avec le template (non mesuré ici) et qui assure les modifications après livraison (forfait mensuel ou à l'heure).

---

# Question 2 : démarchage email B2B pour proposer un site (méthode seulement)

## 2.1 Structure d'un email efficace (consensus des sources, tous **[secondaire]**)

Sources : <https://reapify.io/blog/cold-outreach-that-gets-replies> (2026-02-05), <https://ken.so/blog/web-design-agency-cold-email-clients> (données jusqu'à août 2026, date non visible), <https://nositeleads.uk/guides/cold-email-templates-for-web-designers> (date non visible, marché UK), <https://mailfra.com/blog/cold-email-for-agencies> (date non visible).

1. **Objet** court, spécifique, sans jargon : nom du commerce + une idée (ex. « Un aperçu de page d'accueil pour [Commerce] »). Éviter « Question rapide », « Création de site web ».
2. **Une observation vérifiable** sur le commerce (ex. fiche Google sans site, pas de tarifs en ligne, réservation uniquement sur une page tierce), pas un compliment générique.
3. **Le manque côté client** formulé en bénéfice (voir tarifs, horaires, réserver), sans « vous perdez des clients » ni ton alarmiste.
4. **Une petite étape suivante** (oui/non) : proposer un aperçu, pas un rendez-vous de 30 minutes. Divergence entre sources : NoSite Leads recommande un lien vers un mock-up dans le 1er email ; Kenso déconseille les liens dans le 1er email (risque de délivrabilité, résultat non concluant statistiquement). **[incertain]**, à tester.
5. **Signature complète** : nom, société, adresse, téléphone, **ligne de refus** (« répondez “non merci” et je ne vous écris plus »). Longueur : moins de ~125 mots (Reapify cite Boomerang, 40 M d'emails : chiffre non vérifié à la source → **[incertain]**).
6. Suivi : 1 à 2 relances maximum (sources marketing) ; **en Suisse, voir 2.4 : toute relance programmée pose problème**.

Exemple de trame (placeholders, aucun commerce réel ; à n'envoyer qu'après décision sur le cadre légal, 2.4) :

```
Objet : Un aperçu de page d'accueil pour [Commerce]

Bonjour [Prénom ou « Madame, Monsieur »],

J'ai vu que [Commerce] n'a pas encore de site : on vous trouve sur Google Maps, mais pas vos tarifs ni [prestation clé] ni un moyen de [réserver / demander un devis].

J'ai préparé un aperçu simple, avec vos vrais horaires et services : [lien ou « je peux vous l'envoyer »].
Si cela vous intéresse, on peut en parler 10 minutes ; sinon, aucun souci.

[Prénom Nom], [Société], [adresse postale], [tél.]
Vos coordonnées proviennent de votre fiche publique [Google Maps / annuaire]. Pour ne plus recevoir de message de notre part : répondez « non merci » ; notre information sur les données : [lien].
```

## 2.2 Taux de réponse observés (aucun benchmark spécifique TPE suisses/artisans trouvé)

**Incertain pour tous** : ce sont des données de fournisseurs d'outils ou d'agences, surtout américaines, avec des définitions différentes (par prospect / par email / avec ou sans réponses automatiques).

| Source | Chiffre | Définition / échantillon | Pertinence |
|---|---|---|---|
| Smarter Outbound (services commerciaux, US) <https://www.smarteroutbound.com/benchmarks> (rafraîchi trimestriellement, date non visible) | 5,62 % de réponses par prospect ; médiane des campagnes 4,9 % ; 0,87 % de réponses positives par prospect | 313 campagnes, 277 036 prospects | Entreprises de services locales (proche), mais US et vendeur d'outil | <!-- pragma: allowlist secret -->
| Belkins (cité par <https://somethinginc.com/blog/cold-email-response-rates-2026-data/>) | 0,72 % pour entreprises de 0-10 employés ; 0,49 % pour 11-50 | réponses humaines uniques / emails envoyés, 7,53 M d'emails en 2025 | B2B général ; la plus faible estimation, la plus stricte |
| Sales.co (2026-02-04, maj 2026-11-20) <https://sales.co/research/cold-email-statistics> | 2,09 % de réponses (tous types) ; 0,64 % de réponses « positives » ; 45 % des réponses sont automatiques | 1,37 M de contacts, 2024 à sept. 2026 | B2B générique |
| Kenso <https://ken.so/blog/cold-email-reply-rate-by-company-size> (2026-06 à 08) | Entreprises de 1-10 employés répondent le plus (indice 1,34 vs moyenne de campagne) | 51 campagnes, 16 clients | Confirme que les micro-entreprises répondent plus ; pas de taux absolu comparable |
| Synthèse PitchRadius <https://www.pitchradius.com/blog/cold-email-reply-rate> (2026) | 3,43 % (Instantly), 4,5 % (Hunter), 0,74 % médiane (Smartlead) | rapports de fournisseurs d'outils | Montre l'écart 0,7 % à 4,5 % selon la définition |
| Klaudius (cas client, vendeur d'outil) <https://klaudius.dev/blog/web-agency-first-month-klaudius> | 21 réponses sur 100 entreprises, 5 clients ; site de base USD 400 + USD 100 / mois | **anecdote d'une agence**, avec un site déjà construit pour chaque prospect | **Très incertain** : un seul témoignage, non vérifiable |
| Reapify <https://reapify.io/blog/cold-outreach-that-gets-replies> (2026-02-05) | 1-3 % « moyenne vers un commerce local » ; plus si observation précise | affirmation de blog, source non précisée | [incertain] |

Lecture prudente : **0,5 % à 5 % de réponses humaines** selon la méthode ; fourchette **non transposable** à des TPE suisses sans test. Aucune donnée suisse trouvée.

## 2.3 Erreurs à éviter (sources marketing + droit)

- Séquences automatisées (Lemlist, Apollo, etc.) vers des listes : traitées comme « publicité de masse » en Suisse (2.4).
- Message générique « j'ai vu que votre site pourrait être amélioré » alors que le commerce n'a pas de site : montre l'absence de recherche (Reapify).
- Ton alarmiste, promesses de classement Google, pièces jointes lourdes, liste de prix dans le 1er email (NoSite Leads).
- Cacher l'expéditeur, pas de ligne de refus, ignorer un « non » (LCD + nLPD, 2.4).
- Ignorer l'existence d'une réservation tierce (Salonkee, Fresha) : l'offre doit s'y brancher, pas dénigrer.
- Écrire à une adresse générique (`info@`) en pensant être hors-champ : la loi suisse ne distingue pas (2.4).
- Promettre « site gratuit » sans dire l'abonnement ni la propriété du domaine.

## 2.4 Cadre légal suisse (résumé, **pas un avis juridique**)

### Texte applicable

- **LCD art. 3 al. 1 let. o** (RS 241, état au 1er janvier 2025) [officiel] <https://www.fedlex.admin.ch/eli/cc/1988/223_223_223/fr> : agit de façon déloyale celui qui envoie ou fait envoyer, par voie de télécommunication, de la **publicité de masse** sans lien direct avec une information demandée et omet de requérir **préalablement le consentement** des clients, de mentionner **correctement l'émetteur** ou de les informer de leur droit de s'y **opposer gratuitement et facilement**. Exception : clients dont les coordonnées ont été obtenues **lors d'une vente**, avec indication de la possibilité de refuser, pour des produits/services **propres analogues**.
- Les trois obligations sont cumulatives (consentement préalable, émetteur correct, refus facile) ([secondaire] prospex.ch, état 2026-10-16 : <https://prospex.ch/de/guides/kaltakquise-schweiz/>).
- **Sanction** : l'art. 23 al. 1 LCD punit la concurrence déloyale intentionnelle au sens de l'art. 3, **sur plainte**, d'une peine privative de liberté de trois ans au plus ou d'une peine pécuniaire (texte Fedlex lu) ; action civile possible (art. 9 LCD). Plainte possible auprès du SECO ([officiel] PFPDT <https://www.edoeb.admin.ch/fr/publicite-et-marketing>).

### Position des autorités

- **OFCOM/BAKOM** (2021-07-02) [officiel] <https://www.bakom.admin.ch/fr/quand-les-envois-en-masse-sont-ils-autorises> : l'envoi en masse et automatique n'est autorisé qu'aux destinataires ayant explicitement consenti (opt-in) ; l'expéditeur doit être indiqué avec une personne de contact ; chaque message doit offrir un refus simple et gratuit.
- **PFPDT** [officiel] <https://www.edoeb.admin.ch/fr/publicite-et-marketing> : principe opt-in ; consentement libre, éclairé, actif (pas de case pré-cochée, les CGV ne suffisent pas) ; l'exception « client » exige qu'une vente ait eu lieu (créer un compte ne suffit pas) ; chaque message doit identifier l'expéditeur et proposer un refus simple, en principe un lien de désinscription.

### « Opt-out » en B2B ? Non, en Suisse

- La LCD **ne prévoit pas d'exception B2B** : la Commission suisse pour la loyauté (organe d'autorégulation, **recommandations non contraignantes**) a retenu, dans la décision n° 183/25, que l'art. 3 al. 1 let. o LCD ne distingue pas adresses privées et professionnelles ([secondaire] extrait publié sur faire-werbung.ch : <https://www.faire-werbung.ch/wp-content/uploads/2026/02/183_25-Auszug-aus-LK2191125.pdf>). Même lecture dans un arrêt zurichois cité par prospex.ch (UE160194, 2016-10-18) : **[incertain]**, non relu à la source.
- **« Masse » = automatisation, pas nombre** : décision SLK n° 172/20 du 2021-03-17 (≈ 50 destinataires, 2 emails) : seule compte l'automatisation de l'envoi ; un envoi **« à la main »** n'est pas visé ([secondaire] cabinet Härting : <https://haerting.ch/wissen/schweizerische-lauterkeitskommission-zum-spamverbot-und-dem-begriff-des-massenhaften-versandes/>). Conséquence pratique, **zone grise, pas un feu vert** : un email rédigé et envoyé individuellement serait en principe hors let. o, une séquence ou un publipostage automatisé (même personnalisé par champs) non. Aucun seuil légal.
- **nLPD** (RS 235.1, en vigueur depuis 2023-09-01) : applicable quand une adresse email de personne physique (y compris dans son activité pro, et indépendants en raison individuelle) est traitée. Art. 30 al. 2 let. b : traiter des données **contre la volonté expresse** de la personne = atteinte à la personnalité ; art. 30 al. 3 : en règle générale pas d'atteinte si la personne a rendu les données accessibles à tous et ne s'est pas opposée expressément ([officiel, texte relu] <https://lawbrary.ch/law/art/LPD-v2025.04-fr-art-30/>). Devoir d'informer lorsque les données ne viennent pas de la personne : **art. 19** (au plus tard un mois après la collecte, selon [secondaire] prospex.ch <https://prospex.ch/fr/guides/demarchage-b2b-suisse-loi/> et revexa.io ; **texte de l'art. 19 non relu directement** → [incertain]) ; page PFPDT [officiel] <https://www.edoeb.admin.ch/fr/devoir-dinformer>. Une personne morale n'est pas protégée par la nLPD, mais les personnes de contact le sont.
- **Différence avec le B2C** : en Suisse la règle email est la même B2B et B2C (let. o), ce qui est plus strict qu'en France/UE sur le papier pour le B2B.

### Comparaison brève RGPD / ePrivacy (pertinent si destinataires ou émetteur dans l'UE)

- **Directive ePrivacy 2002/58/CE, art. 13** [officiel] <https://eur-lex.europa.eu/LexUriServ/LexUriServ.do?uri=CELEX%3A32002L0058%3AFR%3AHTML> : consentement préalable pour l'email de prospection envers les abonnés **personnes physiques** (par. 1) ; exception « client » (par. 2) ; interdiction de masquer l'émetteur (par. 4) ; pour les **personnes morales**, les États membres doivent protéger les « intérêts légitimes » mais choisissent le régime (par. 5, considérant 45).
- **France (CNIL, 2026-06-10)** [officiel] <https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique-sms-mms-et-automate-dappel> : B2B possible **sans consentement** si information + droit d'opposition simple au moment de la collecte et si l'objet est en rapport avec la profession ; adresses génériques `info@` hors champ. Un juriste (Village de la Justice, <https://www.village-justice.com/articles/prospection-commerciale-par-mail-btob-peut-vraiment-contenter-opt-out,46443.html>, date non visible) note que ce régime B2B n'est pas dans la directive ni le RGPD et pourrait évoluer : **[incertain]**.
- Donc : **ne pas importer la logique « opt-out B2B » française en Suisse**.

### Téléphone : astérisque (liste « étoile »)

- **LCD art. 3 al. 1 let. u** [officiel, texte Fedlex lu] : interdit de ne pas respecter la mention d'annuaire (astérisque) ; les clients non inscrits à l'annuaire sont traités de la même manière (depuis 2021). Le démarchage téléphonique est **en principe autorisé** ; l'astérisque l'interdit, hors relation commerciale existante ([officiel] SECO <https://www.seco.admin.ch/fr/appels-publicitaires-indesirables>). Let. v : appel publicitaire avec un numéro d'appel inscrit à l'annuaire et utilisable (texte via [secondaire] ODAT <https://ch.odat.ch/fr/cc/241-20250101-fr.html>). Tribunal fédéral, ATF 149 IV 1 (6B_978/2020) : relation commerciale à interpréter **restrictivement** ([secondaire] <https://www.crimen.ch/158/>).
- Application aux **entreprises** (astérisque sur raison sociale) : doctrine dominante favorable selon [secondaire] prospex.ch ; SECO parle de « personnes/clients » : **[incertain]**. Vérifier l'inscription sur local.ch / search.ch avant tout appel.

### Rappel : ce que ce résumé ne couvre pas

Pas de lecture de jurisprudence cantonale, pas d'avis d'avocat, pas de vérification des CGU des outils d'envoi. Les articles de prospex.ch, Härting, lettro.ch et revexa.io sont des sources privées (cabinet, éditeurs d'outils de prospection, intérêts commerciaux).

## 2.5 Alternatives moins risquées

| Canal | Cadre | Coût / remarque | Source |
|---|---|---|---|
| **Visite sur place** (sans rendez-vous) | La loi sur le commerce itinérant (RS 943.1) vise la sollicitation de **consommateurs** ; la visite B2B d'un commerce ouvert n'y est pas soumise en principe. Règles communales éventuelles : non vérifiées → [incertain] | Coût direct nul ; arrêter dès qu'on nous dit non ; aucun traitement massif | [officiel] <https://www.fedlex.admin.ch/eli/cc/2002/452/fr>, <https://www.seco.admin.ch/fr/commercants-itinerants> |
| **Visite ou appel → consentement oral/écrit → email** | Si le commerçant accepte explicitement de recevoir un aperçu, le consentement exigé par la let. o est obtenu (le consigner) | Le plus sûr pour l'email ; garder une trace | PFPDT (consentement actif) <https://www.edoeb.admin.ch/fr/publicite-et-marketing> |
| **Courrier postal adressé** | Pas de règle LCD spécifique ; selon le PFPDT, usage d'une adresse **publiée** à des fins publicitaires en principe conforme à la protection des données tant que la personne ne l'a pas interdit ; l'autocollant « Pas de publicité » vise la publicité **non adressée** ; liste Robinson de la SDV : particuliers ; **respecter toute opposition** | Poste CH, édition janvier 2026 [officiel] : lettre Courrier B jusqu'à 100 g = **CHF 1.00**, Courrier A = CHF 1.20 (TVA incluse, envoi isolé) ; « Mailing Courrier B » dès 350 exemplaires (tarif unitaire non publié sur les pages lues) | PFPDT <https://www.edoeb.admin.ch/fr/publicite-et-marketing> ; Poste <https://www.post.ch/fr/expedier-des-lettres/lettres-suisse/lettre-en-courrier-b>, <https://www.post.ch/fr/expedier-des-lettres/envoi-en-nombre-de-lettres/envois-en-nombre-suisse> ; liste Robinson/entreprises : [secondaire] prospex.ch |
| **Téléphone** | Autorisé hors astérisque / numéro non inscrit ; afficher un numéro inscrit ; conversation menée par une personne | Pour des indépendants (numéros souvent mobiles), vérifier l'astérisque | SECO, BAKOM (cités plus haut) |
| **Lettre + QR vers un aperçu** | comme courrier ci-dessus | ≈ CHF 1.00 + impression | idem |

## 2.6 Grille de pricing réaliste

### Ce que facturent les prestataires (prix publics)

| Prestataire / source | Offre | Prix (devise d'origine) | ≈ CHF | Fiabilité |
|---|---|---|---|---|
| Helveit (Genève) <https://helveit.ch> (page lue 2026-11-27) | « Site essentiel » : jusqu'à 3 pages, mobile, formulaire, bases SEO, domaine .ch + hébergement 12 mois | dès CHF 1'000 TTC (paiement 50 % commande / 50 % livraison) ; hébergement suivi 35 CHF / mois TTC ; SEO local suivi 390 CHF / mois TTC | 1'000 TTC | [officiel] |
| Make Your Website <https://makeyourwebsite.ch> (lue 2026-11-27) | Site vitrine jusqu'à 5 pages, domaine et hébergement .ch annoncés dans la description | dès CHF 499 ; « on s'occupe de tout » dès CHF 29 / mois | 499 ; 29 / mois | [officiel] ; périmètre exact des inclusions flou |
| Webetiq (Neuchâtel) <https://webetiq.ch> (lue 2026-11-27) | Pack Essentiel, 5 pages, 7 jours, 1 an de support | CHF 999 + hébergement CHF 99 / an | 999 + 99 / an | [officiel] |
| Pixelium (Lausanne) | One Page Next.js CHF 990 ; vitrine complète dès CHF 2'500 ; maintenance CHF 90 / 190 / 290 / mois ; page supplémentaire +300 | | | [secondaire] (via patrykochman.com 2026-08-26 ; page tarifs officielle non retrouvée à l'URL testée) → [incertain] |
| Relevé romand (freelance indépendant, **intérêt commercial déclaré**) <https://patrykochman.com/prix-site-internet-suisse/> (2026-08-26) | 11 prestataires sur 19 publient un prix ; vitrine le plus souvent CHF 1'499, moitié des offres entre CHF 799 et 2'900 ; prix publiés de CHF 499 à 12'200 | | | [secondaire] ; chaque ligne renvoie au site du prestataire |
| France, freelance (neenot, 2026-11-18) <https://neenot.com/fr/prix-site-vitrine> | médiane EUR 1'200 HT (moitié des prix entre 690 et 1'800) ; location de site EUR 30-40 / mois | | 1'099 (médiane) ; 27-37 / mois | [secondaire], prestataire concerné |
| France, artisans (cdcode.fr, maj 2026-06-20) <https://cdcode.fr/combien-coute-site-internet-vitrine-tpe-artisan/> ; RescueWeb (maj 2026-11-15) <https://rescueweb.fr/blog/combien-coute-site-internet-artisan> | freelance EUR 800-2'500 ; maintenance EUR 30-80 / mois ; abonnement EUR 19.90 HT / mois sans frais de création (RescueWeb) | | 732-2'289 ; 27-73 / mois ; 18.22 / mois | [secondaire] |
| Allemagne (homepage-atelier.de, oct. 2026) <https://homepage-atelier.de/ratgeber/was-kostet-eine-website/> | Visitenkarte / one-pager : freelance EUR 500-1'500, agence EUR 1'000-3'000 ; hébergement EUR 50-300 / an | | 458-1'374 ; 916-2'747 | [secondaire] |

Ordre de grandeur : **CHF 500 à 1'500 pour un petit site vitrine en forfait**, abonnements autour de **CHF 20 à 40 / mois**, nettement sous la médiane des agences établies (qui ne publient souvent aucun prix : 8 sur 19 selon le relevé romand).

### Grille proposée (hypothèse de travail, non issue d'une source ; marges à calculer par Théo)

| Formule | Mise en place | Récurrent | Inclus (suggestion) | Position vs marché |
|---|---|---|---|---|
| **Forfait unique « Vitrine essentielle »** | CHF 790 à 990 | hébergement + domaine + email au coût ≈ CHF 120 à 160 / an (voir Q1) | 3-5 pages, mobile, formulaire, JSON-LD LocalBusiness, fiche Google revendiquée, domaine au nom du client, 1 formation courte | Au niveau de Webetiq (999) et Helveit (1'000), au-dessus de Make Your Website (499) |
| **Abonnement « tout compris »** | CHF 0 à 290 | CHF 29 à 39 / mois, engagement 12 mois, modifications raisonnables incluses | idem + petites modifications ; clause : domaine et fichiers remis au client à la fin | Au niveau de Make Your Website (29 / mois) et des abonnements FR (≈ 27-37 CHF) |
| **Option SEO local** | selon périmètre | non chiffré ici | pas de comparatif solide trouvé hors Helveit (390 CHF / mois TTC, haut de gamme) | **[incertain]** |

Coût sur 3 ans (calcul maison, sans marge de notre côté ni TVA) : forfait CHF 890 + 3 × 140 ≈ **CHF 1'310** ; abonnement CHF 190 + 36 × 35 ≈ **CHF 1'450**. L'abonnement revient plus cher à terme mais lisse le budget (utile pour des commerces à faible trésorerie) ; à comparer au relevé français (RescueWeb : EUR 716 HT sur 3 ans, soit ≈ CHF 656, cas le plus bas relevé).

Précautions de devis relevées dans les sources : prix TTC ou HT précisé (beaucoup d'indépendants ne sont pas assujettis à la TVA sous CHF 100'000 de chiffre d'affaires selon patrykochman.com, [secondaire] ; non revérifié à l'AFC) ; propriété du domaine et des fichiers écrite dans le devis ; périmètre (pages, textes, photos) explicite.

## 2.7 Recommandation finale (5 lignes)

1. **Ne pas lancer de campagne email automatisée à froid** : en Suisse la let. o LCD exige un consentement préalable même en B2B, sans exception « opt-out B2B ».
2. **Canal prioritaire : visite sur place ou appel (hors astérisque), puis demande d'accord explicite pour envoyer un aperçu par email** ; le consentement obtenu sécurise le premier email.
3. Si un email froid est quand même envisagé : **individuel, rédigé à la main**, identité complète, refus en une ligne, information sur la source de l'adresse (nLPD), **pas de relance programmée** ; décision et risque à valider par un juriste.
4. **Courrier postal adressé** (CHF 1.00 la lettre en Courrier B) comme second canal peu risqué, avec aperçu consultable par QR code.
5. **Offre : forfait CHF 790-990 ou abonnement CHF 29-39 / mois**, domaine au nom du client ; tester sur 10 commerces avant de généraliser, en mesurant les réponses humaines (les benchmarks génériques vont de 0,5 % à 5 %).

---

# Sources par question (consultées 2026-11-27)

## Q1 (≥ 5 distinctes)
1. Hostpoint Sites [officiel] <https://www.hostpoint.ch/en/website/> (date non visible)
2. Hostpoint Domaines [officiel] <https://www.hostpoint.ch/en/domains/>
3. Infomaniak, formules Site Creator [officiel] <https://www.infomaniak.com/fr/support/faq/2518/decouvrir-les-differentes-formules-site-creator>
4. Infomaniak, Service Mail / kSuite [officiel] <https://www.infomaniak.com/fr/ksuite/service-mail/tarifs>
5. Vägar, test Site Creator [secondaire] <https://vagar.ch/avis/infomaniak-site-creator> (2026-10-29)
6. webtesten.ch, Site Creator et domaines [secondaire] <https://webtesten.ch/testberichte/infomaniak-site-creator-avis/> (2026-08-20), <https://webtesten.ch/testberichte/infomaniak-erfahrungen/> (2026-08-19)
7. Framer pricing [officiel] <https://www.framer.com/pricing>
8. Webflow pricing et aide [officiel] <https://webflow.com/pricing>, <https://help.webflow.com/hc/en-us/articles/51059955082387-Updated-pricing-and-simplified-plans-for-May-2026> (2026-08-31)
9. Jimdo pricing [officiel] <https://www.jimdo.com/pricing/>
10. Hostinger Website Builder [officiel] <https://www.hostinger.com/website-builder>
11. Wix via blitzweb.ch (2026-11-09), maltconsulting.ch (2026-10-28), jeremylecca.ch (2026-11-14) [secondaire]
12. Vercel pricing, régions [officiel] <https://vercel.com/pricing>, <https://vercel.com/docs/regions>
13. Next.js export statique [officiel] <https://nextjs.org/docs/app/guides/static-exports>
14. Google Search Central, LocalBusiness [officiel] <https://developers.google.com/search/docs/appearance/structured-data/local-business> (2026-09-08)
15. Aide Google Business Profile [officiel] <https://support.google.com/business/answer/2911778?hl=fr>
16. Helvesite, comparatif hébergeurs [secondaire] <https://helvesite.ch/blog/hebergeur-web-suisse-infomaniak-hostpoint-hostinger/> (2026-11-15) ; 0ggi.ch [secondaire] (2026-10-23) ; bearhost.com [secondaire] (2026-10-26)
17. BCE, taux du 2026-11-27 [officiel] (voir §0)

## Q2 (≥ 5 distinctes)
1. LCD, Fedlex [officiel] <https://www.fedlex.admin.ch/eli/cc/1988/223_223_223/fr> (état 2025-01-01)
2. PFPDT, publicité et marketing [officiel] <https://www.edoeb.admin.ch/fr/publicite-et-marketing> ; devoir d'informer <https://www.edoeb.admin.ch/fr/devoir-dinformer>
3. OFCOM/BAKOM [officiel] <https://www.bakom.admin.ch/fr/quand-les-envois-en-masse-sont-ils-autorises> (2021-07-02)
4. SECO, appels publicitaires [officiel] <https://www.seco.admin.ch/fr/appels-publicitaires-indesirables> ; commerçants itinérants <https://www.seco.admin.ch/fr/commercants-itinerants>
5. nLPD art. 30 [officiel/texte] <https://lawbrary.ch/law/art/LPD-v2025.04-fr-art-30/>
6. SLK n° 183/25 [secondaire] faire-werbung.ch ; Härting sur SLK 172/20 [secondaire] ; crimen.ch sur ATF 149 IV 1 [secondaire]
7. prospex.ch [secondaire] <https://prospex.ch/de/guides/kaltakquise-schweiz/> et <https://prospex.ch/fr/guides/demarchage-b2b-suisse-loi/> (état 2026-10-16)
8. Directive ePrivacy art. 13 [officiel] EUR-Lex (lien ci-dessus) ; CNIL [officiel] (2026-06-10) ; Village de la Justice [secondaire]
9. Poste CH, prix lettres [officiel] <https://www.post.ch/fr/expedier-des-lettres/lettres-suisse/lettre-en-courrier-b> ; offre janvier 2026 <https://www.post.ch/fr/pages/adaptation-offre-lettres-et-colis>
10. Benchmarks de réponse : Smarter Outbound, Sales.co (2026-02-04, maj 2026-11-20), Belkins via somethinginc.com, Kenso, PitchRadius, Reapify (2026-02-05), Klaudius [secondaire] <!-- pragma: allowlist secret -->
11. Prix : Helveit, Make Your Website, Webetiq [officiel] ; patrykochman.com (2026-08-26), neenot.com (2026-11-18), cdcode.fr (2026-06-20), RescueWeb (2026-11-15), homepage-atelier.de (2026-10) [secondaire]

---

# Points qui demandent décision de Théo

1. **Posture email** : (a) aucun email froid, consentement d'abord (recommandé) ; (b) emails individuels écrits à la main, risque résiduel assumé ; (c) consulter un juriste suisse avant toute campagne. Aucun envoi n'a été fait.
2. **Canaux prioritaires** : visite + appel d'abord ? courrier postal comme 2e canal ? budget courrier (CHF 1.00 / lettre + impression).
3. **Pile technique** : option B (Next.js + template, recommandé) ou A (Hostpoint Sites) pour les clients qui veulent éditer eux-mêmes ; qui assure les modifications après livraison.
4. **Modèle de prix** : forfait unique, abonnement, ou les deux ; niveau de marge ; engagement 12 mois ou non ; clause de remise du domaine et des fichiers.
5. **Identité de l'expéditeur** : sous quelle entité et quel nom commercial (Resell Lausanne ou marque séparée), adresse postale à afficher, page nLPD / confidentialité à publier.
6. **Service Google Business Profile** : inclus dans l'offre (revendication des fiches non revendiquées, avec accord du commerçant) ou option payante.
7. **Hébergement** : hébergeur suisse (Infomaniak / Hostpoint / MaxiHoster) sous compte client ou sous compte à nous ; pas d'usage du VPS Hetzner pour les sites clients sans décision (localisation des données hors Suisse, non vérifiée ici).
8. **Mock-ups préalables** : accepte-t-on d'en préparer avant tout contact (travail non sollicité, avec uniquement des informations publiques) ?

# Limites

- **Aucune vérification en conditions réelles** : aucun builder testé, aucun email envoyé, aucun commerçant contacté.
- **Prix Infomaniak Site Creator et domaines** : lus via des sources secondaires (la page tarifs officielle n'a pas rendu les montants). Wix : pas de prix officiel en CHF ; prix en EUR via blogs suisses. Webflow, Framer, Jimdo, Hostinger : devise et TVA dépendent de la localisation du serveur de lecture (USD affiché) ; conversion au taux BCE du 2026-11-27, indicative.
- **Les coûts annuels par option (§1.3) et le tableau 3 ans (§2.6) sont des calculs maison** à partir de ces prix ; l'estimation de temps par site pour l'option B n'est pas sourcée.
- **Taux de réponse** : aucun benchmark suisse ni spécifique TPE/artisans trouvé ; chiffres de fournisseurs d'outils, définitions hétérogènes ; le cas Klaudius est une anecdote.
- **Droit** : textes fedlex lus via les pages renvoyées par la recherche (la page Fedlex directe a expiré à la lecture) ; l'art. 19 nLPD n'a pas été relu à la source ; les décisions SLK sont des recommandations d'autorégulation ; la doctrine sur l'astérisque pour les personnes morales est tirée de sources privées. Pas d'avis d'avocat.
- Plusieurs sources de prix sont des agences ou indépendants qui vendent la prestation décrite (intérêt commercial) ; marqués [secondaire].
- Comparaison RGPD/ePrivacy limitée à la directive et à la CNIL (pas d'autre État membre).
- Les 10 commerces du rapport #564 n'ont pas été re-vérifiés ; aucune donnée de contact n'est reprise ici.
