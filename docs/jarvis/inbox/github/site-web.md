# Site web extrait de GitHub

Extraction du 2026-11-24 depuis `reselllausanne/resell-lausanne.ch` à `0035470`. Git ne prouve ni le thème publié ni la configuration Shopify Admin; ces limites restent explicites.

### F-001
- sujet: thème probable
- date: 2026-11-11
- source: `resell-lausanne.ch/fullstack_2_3_1/config/settings_schema.json:3-8` et `layout/theme.liquid:81-138` — SHA `0035470`, PR #13
- statut: incertain
- valeur: `fullstack_2_3_1/` est la cible de thème la plus probable. Le thème effectivement publié n’est pas prouvable depuis Git.

### F-002
- sujet: risque de mauvais arbre de thème
- date: 2026-11-11
- source: `resell-lausanne.ch/README.md:5-6`; `fullstack_2_3_1/.shopifyignore:12-17` — SHA `0035470`
- statut: actif
- valeur: La racine contient un ancien Shopify Skeleton distinct de `fullstack_2_3_1/`. `settings_data.json` est exclu du push, donc navigation, homepage et configuration Admin peuvent diverger du dépôt.

### F-003
- sujet: langues
- date: 2026-11-11
- source: `resell-lausanne.ch/translation-code-audit.md:18`; `fullstack_2_3_1/locales/` — SHA `0035470`
- statut: incertain
- valeur: Le code prouve le français par défaut, l’anglais et l’allemand. Des fichiers italien et polonais existent, mais leur publication dans Shopify Markets est inconnue.

### F-004
- sujet: délai de demande de retour
- date: 2026-08-16
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/resell-page-return-policy-body.liquid:105,125-131` — SHA `9b3b112`
- statut: actif
- valeur: La demande doit être faite sous 14 jours calendaires et autorisée avant tout renvoi.

### F-005
- sujet: périmètre des retours volontaires
- date: 2026-09-05
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/resell-page-return-policy-body.liquid:111-123` — SHAs `9b3b112`, `957dc84`
- statut: actif
- valeur: Les retours volontaires sont limités aux chaussures. Sont exclus les autres catégories, les articles dépassant le seuil tarifaire publié, les promotions et certains défauts liés à l’âge.

### F-006
- sujet: issue d’un retour de convenance
- date: 2026-08-16
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/resell-page-return-policy-body.liquid:133-140` — SHA `9b3b112`
- statut: actif
- valeur: Un retour de convenance donne lieu à échange ou avoir avec retenue de 10 %, sans remboursement sur carte.

### F-007
- sujet: erreur, défaut ou non-conformité
- date: 2026-08-16
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/resell-page-return-policy-body.liquid:142-143`; `resell-page-authenticite.liquid:124-166` — SHA `9b3b112`
- statut: actif
- valeur: Une erreur, un défaut ou une non-conformité suit une voie distincte et peut donner lieu à remboursement. L’échec d’authentification entraîne annulation ou remboursement.

### F-008
- sujet: âge des paires
- date: 2026-10-24
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/rs-old-pair-notice.liquid:6-7,33-34`; `rs-product-aged-pair-warning-signals.liquid:19,47-50` — SHAs `957dc84`, `f15f5f8`; PR #2
- statut: incertain
- valeur: La politique et l’ancien bandeau utilisent « 2016 ou avant », tandis que le signal récent utilise 15 ans; un seuil de 9 ans a aussi existé. Aucun seuil unique n’est déduit.

### F-009
- sujet: délais de livraison
- date: 2026-08-16
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/resell-faq-livraison-article.liquid:73-75,118-130` — SHA `9b3b112`
- statut: actif
- valeur: La livraison standard Suisse/Europe est annoncée à 5–10 jours ouvrables et l’express éligible à 2–5 jours. La Suisse est gratuite dès 50 CHF; l’Europe est facturée 10 CHF, taxes/import à charge du client.

### F-010
- sujet: colis non réclamé
- date: 2026-08-16
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/resell-faq-livraison-article.liquid:170-179`; `resell-page-cgv-body.liquid:324-327` — SHA `9b3b112`
- statut: actif
- valeur: Un colis non réclamé entraîne un forfait de 20 CHF.

### F-011
- sujet: contenu légal hors Git
- date: 2026-11-11
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/resell-legal-hub.liquid:149-164`; `locales/fr.default.json:628` — SHA `0035470`
- statut: incertain
- valeur: Les CGU et mentions légales peuvent venir de `page.content` ou `shop.policies` dans Shopify Admin. Leur corps réellement publié n’est donc pas attesté par Git.

### F-012
- sujet: consentement marketing
- date: 2026-11-11
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/resell-page-privacy-body.liquid:97-100`; `blocks/newsletter-signup.liquid:18-19` — SHA `0035470`
- statut: incertain
- valeur: La politique affirme un consentement marketing explicite, mais le formulaire newsletter versionné ne montre pas de case dédiée. Une logique Admin ou Klaviyo invisible peut compléter le parcours.

### F-013
- sujet: mesure et consentement analytics
- date: 2026-10-15
- source: `resell-lausanne.ch/fullstack_2_3_1/layout/theme.liquid:81-107`; `assets/product-form.js:14-24`; `scripts/validate-p2.js:671-685` — SHA `0035470`; PRs #8 à #11
- statut: incertain
- valeur: Le thème publie des événements first-party et charge un outil analytics sans garde de consentement visible. La CMP et les Web Pixels éventuellement configurés dans Shopify Admin restent hors Git.

### F-014
- sujet: intégrations d’avis et marketing
- date: 2026-11-11
- source: `resell-lausanne.ch/fullstack_2_3_1/blocks/resell-store-rating.liquid:242`; `snippets/resell-trustpilot-trustbox.liquid`; `blocks/_product-add-to-cart-button.liquid:80,152-156` — SHA `0035470`
- statut: actif
- valeur: Le thème contient Judge.me, Trustpilot et un déclencheur Klaviyo Back in Stock. Les flows, listes, consentements et états d’app réels restent dans les systèmes Admin.

### F-015
- sujet: texte de confidentialité non actif
- date: 2026-10-19
- source: `resell-lausanne.ch/fullstack_2_3_1/snippets/resell-page-privacy-body.liquid:97-100` — commit `3d241f0`, PR #12 non fusionnée
- statut: actif
- valeur: Le texte sur la mesure first-party existe seulement dans une PR brouillon non fusionnée. Il ne décrit pas l’état de `main`.
