# Workflows automatiques extraits de GitHub

Extraction du 2026-11-24. Les cadences citées sont des paramètres de code, pas des mesures de production.

### F-001
- sujet: déploiement VPS
- date: 2026-11-10
- source: `.github/workflows/deploy-vps.yml:1-14,38-58,94-129` — SHA `1b783852`, PR #410
- statut: actif
- valeur: Chaque changement exécutable poussé sur `main` valide Docker/Compose puis déploie le SHA exact sur le VPS par SSH. La concurrence est sérialisée.

### F-002
- sujet: ingestion EDI Galaxus
- date: 2026-08-19
- source: `docker-compose.yml:106-123` — SHA `2d2191a9`
- statut: actif
- valeur: Un worker dédié traite les flux EDI Galaxus en fuseau Zurich, avec boucle fréquente pour la livraison directe et passage planifié pour l’entrepôt.

### F-003
- sujet: génération des feeds Galaxus
- date: 2026-10-26
- source: `docker-compose.yml:125-151` — SHAs `65ef029c`, `39e0d4bc`
- statut: actif
- valeur: Un worker dédié construit les feeds et draine un traitement en cours lors d’un déploiement. Le processus Node est PID 1 pour recevoir correctement `SIGTERM`.

### F-004
- sujet: jobs de fond Galaxus
- date: 2026-11-12
- source: `galaxus/ops/jobDefinitions.ts:11-32` — SHA `7e47c834`, PR #451
- statut: actif
- valeur: Les jobs couvrent synchronisation partenaire, rafraîchissement StockX, images, commandes Shopify, stock multicanal, réconciliation d’inventaire et reprise DELR.

### F-005
- sujet: maintien des prix StockX sur Shopify
- date: 2026-10-31
- source: `docker-compose.yml:190-218` — SHA `bf5e6eed`, PR #327
- statut: actif
- valeur: Un worker traite d’abord les produits les plus anciens jusqu’au seuil de fraîcheur, avec checkpoint persistant. Le reprice rapide continu a été retiré pour éviter la concurrence avec SSE et la convergence.

### F-006
- sujet: contrôles de ventes Shopify
- date: 2026-10-31
- source: `docker-compose.yml:93-103` — SHA `bf5e6eed`, PR #327
- statut: actif
- valeur: Un worker vérifie périodiquement les ventes Shopify après un délai initial, en conservant son état dans le volume persistant.

### F-007
- sujet: enrichissement et import partenaires
- date: 2026-04-11
- source: `docker-compose.yml:31-59` — SHA `d50d6bf2`
- statut: actif
- valeur: Des workers séparés enrichissent les uploads partenaires et importent les CSV via files de jobs persistantes afin d’éviter les délais HTTP.

### F-008
- sujet: auto-achat StockX
- date: 2026-11-11
- source: `docs/STOCKX-BUYER.md:7-25,36-44` — SHA `19e4b840`, PR #415; `lib/stockxBuyer/policy.ts:40-53,140-143`
- statut: actif
- valeur: Le buyer traite Shopify et Galaxus sous verrou unique, mémorise chaque résultat et réessaie les erreurs transitoires avec backoff. Les résultats ambigus passent en revue humaine.

### F-009
- sujet: réconciliation de stock fournisseur
- date: 2026-09-17
- source: `docs/SUPPLIER-STOCK-RECONCILIATION.md:90-108` — SHA `c997935d`
- statut: actif
- valeur: Tous les scrapes doivent passer par le runner central et finaliser exactement une fois. Les notifications email indiquent explicitement leur état d’envoi; SMS et WhatsApp ne sont pas implémentés.

### F-010
- sujet: sGTM
- date: 2026-10-19
- source: `docker-compose.yml:220-259` — SHA `beff9170`, PR #154
- statut: incertain
- valeur: Une infrastructure server-side Google Tag Manager existe derrière un profil Compose optionnel. Son activation en production n’est pas démontrée par le dépôt.
