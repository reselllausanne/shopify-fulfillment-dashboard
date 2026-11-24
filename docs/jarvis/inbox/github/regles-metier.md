# Règles métier extraites de GitHub

Extraction du 2026-11-24. Les décisions confirmées de `docs/jarvis/memory/decisions.md` priment sur les commentaires de code; les conflits restent marqués `incertain`.

### F-001
- sujet: canal d’achat
- date: 2026-11-11
- source: `docs/jarvis/memory/decisions.md:24-27` — SHA `80eb2466`, PR #485
- statut: actif
- valeur: Les achats sont effectués uniquement sur StockX. Aucun achat hors StockX ni double achat.

### F-002
- sujet: tolérance de perte à l’achat
- date: 2026-11-18
- source: `docs/jarvis/memory/decisions.md:15-20` — SHA `490667b1`, PR #477
- statut: actif
- valeur: La perte maximale acceptée est de 10 % pour tous les achats; Galaxus applique aussi un plafond de 400 CHF.

### F-003
- sujet: revenu Galaxus
- date: 2026-11-20
- source: `docs/jarvis/memory/decisions.md:35-40` — SHA `80eb2466`, PR #485; `galaxus/orders/margin.ts:1-4` — SHA `08f4d0e5`
- statut: actif
- valeur: Le revenu Galaxus est le montant net de ligne payé à Resell Lausanne. Aucune commission de marketplace n’est retranchée; le profit est revenu moins coût StockX.

### F-004
- sujet: plafond d’assortiment Galaxus
- date: 2026-11-16
- source: `docs/jarvis/memory/decisions.md:42-47` — SHA `80eb2466`, PR #485; `galaxus/exports/assortmentPolicy.ts:35-38` — SHA `a4898474`, PR #465
- statut: incertain
- valeur: La décision D-006 exempte LEGO du plafond de 300 CHF, tandis que le code courant dit que LEGO n’est pas exempt. Aucun choix n’est fait dans cette extraction.

### F-005
- sujet: périmètre de catégories Galaxus
- date: 2026-11-16
- source: `docs/jarvis/memory/decisions.md:63-68` — SHA `80eb2466`, PR #485; `galaxus/exports/assortmentPolicy.ts:19-44` — SHA `a4898474`, PR #465
- statut: actif
- valeur: L’assortiment Galaxus est limité aux catégories convenues et bloque notamment jouets/hobby, consoles, alimentaire et catégories non-mode, avec exceptions explicites dans le code.

### F-006
- sujet: fournisseurs désactivés sur Galaxus
- date: 2026-11-11
- source: `docs/jarvis/memory/decisions.md:56-61` — SHA `80eb2466`, PR #485; PR #434
- statut: actif
- valeur: Les fournisseurs `alt`, `haw`, `exl`, `ven`, `wrk`, `fan`, `bae` et `bwz` ne doivent plus alimenter les feeds Galaxus. Les données de scraping sont conservées.

### F-007
- sujet: offres Decathlon
- date: 2026-08-24
- source: `docs/jarvis/memory/decisions.md:76-81` — SHA `80eb2466`, PR #485
- statut: actif
- valeur: Toutes les offres Decathlon doivent rester retirées et ne pas être remises en vente.

### F-008
- sujet: marge WellPlayed
- date: 2026-08-23
- source: `docs/jarvis/memory/decisions.md:83-88` — SHA `80eb2466`, PR #485; `galaxus/exports/pricing.ts:75-87` — SHA `72ad22b3`, PR #452
- statut: actif
- valeur: Les produits WellPlayed appliquent au moins 15 % de marge nette et un tampon fixe de 1 CHF. Les prix Reichelt ne doivent pas être modifiés par cette règle.

### F-009
- sujet: formule de prix Shopify
- date: 2026-11-17
- source: `docs/jarvis/memory/decisions.md:90-95` — SHA `2b4ff88a`, PR #471; PR #483
- statut: actif
- valeur: La formule Shopify de référence est la version du 19 août 2026; les implémentations TypeScript et Python doivent rester alignées.

### F-010
- sujet: preuve de stock fournisseur
- date: 2026-09-17
- source: `docs/SUPPLIER-STOCK-RECONCILIATION.md:1-7,30-46` — SHA `c997935d`
- statut: actif
- valeur: Un stock ne peut être publié qu’avec une preuve fraîche de page fournisseur couvrant identité, prix, disponibilité et absence de précommande. Le stock historique en base ne constitue pas une preuve.

### F-011
- sujet: fuseau métier
- date: 2026-11-20
- source: `docs/jarvis/memory/decisions.md:106-110` — SHA `80eb2466`, PR #485; `AGENTS.md:32-37`
- statut: actif
- valeur: Les calculs métier utilisent le fuseau `Europe/Zurich`.
