# Intégrations et comptes extraits de GitHub

Extraction du 2026-11-24. Noms de systèmes et rôles seulement; aucun identifiant de personne, jeton ou secret.

### F-001
- sujet: Shopify
- date: 2026-11-23
- source: `docs/jarvis/SOURCES.md:12-18` — SHA `80eb2466`, PR #485; `README.md:50-69`
- statut: actif
- valeur: Shopify Admin API est la source de vérité des commandes Shopify; la base locale sert de miroir opérationnel. L’intégration couvre aussi produits, inventaire, emplacements, fulfillments et retours.

### F-002
- sujet: Galaxus
- date: 2026-11-23
- source: `docs/jarvis/SOURCES.md:16-19` — SHA `80eb2466`, PR #485; `docker-compose.yml:106-123`
- statut: actif
- valeur: Les commandes et états Galaxus sont stockés en base; les échanges EDI et feeds utilisent SFTP. Deux parcours existent: livraison directe et expédition depuis entrepôt.

### F-003
- sujet: Decathlon Mirakl
- date: 2026-07-19
- source: `README.md:194-278` — SHA `d142f575`; `docs/jarvis/SOURCES.md:18-19` — SHA `80eb2466`, PR #485
- statut: actif
- valeur: Mirakl reste intégré pour le suivi des commandes et le traitement des retours Decathlon, même si les offres sont retirées.

### F-004
- sujet: StockX
- date: 2026-11-11
- source: `docs/STOCKX-BUYER.md:1-7,15-25` — SHA `19e4b840`, PR #415
- statut: actif
- valeur: StockX est le canal d’approvisionnement automatisé commun aux commandes Shopify et Galaxus. Le buyer utilise navigateur persistant, journal d’idempotence et rapprochement des achats.

### F-005
- sujet: GOAT
- date: 2026-11-11
- source: `docs/STOCKX-BUYER.md:27-35,86-90` — SHA `19e4b840`, PR #415
- statut: actif
- valeur: GOAT est consulté pour comparaison et alerte uniquement. Aucun checkout GOAT n’est implémenté.

### F-006
- sujet: Supabase Postgres
- date: 2026-11-23
- source: `docs/jarvis/SOURCES.md:14-22,40-45` — SHA `80eb2466`, PR #485
- statut: actif
- valeur: Postgres/Supabase porte les états de catalogue, stock, commandes, achats et synchronisations. Les accès Jarvis sont conçus en lecture seule côté session cliente.

### F-007
- sujet: Swiss Post
- date: 2026-09-23
- source: `docs/AUTO-PRINT-STATIONS.md:14-20` — SHA `cf8082f1`; `README.md:296-308`
- statut: actif
- valeur: Swiss Post fournit les étiquettes d’expédition et de retour. Les licences de facturation peuvent être séparées par rôle ou parcours.

### F-008
- sujet: QZ Tray
- date: 2026-09-23
- source: `docs/AUTO-PRINT-STATIONS.md:22-55` — SHA `cf8082f1`
- statut: actif
- valeur: QZ Tray permet l’impression silencieuse par poste avec certificat partagé côté serveur et réglages d’imprimante propres à chaque navigateur.

### F-009
- sujet: Google Ads et Search Console
- date: 2026-11-23
- source: `docs/jarvis/SOURCES.md:21-24` — SHA `80eb2466`, PR #485
- statut: actif
- valeur: Google Ads alimente les analyses publicitaires et Search Console les données SEO. Les deux sont lus à la demande; aucune donnée vivante n’est mémorisée dans ces fiches.

### F-010
- sujet: GitHub et VPS
- date: 2026-11-20
- source: `AGENTS.md:16-28` — SHA `80eb2466`, PR #485; `.github/workflows/deploy-vps.yml:80-101`
- statut: actif
- valeur: GitHub `main` est la source de vérité du code; le VPS est une cible de déploiement. GitHub Actions utilise des secrets SSH gérés hors dépôt pour installer le SHA exact.

### F-011
- sujet: Shopify MCP Cursor
- date: 2026-11-20
- source: `docs/jarvis/SOURCES.md:27-34` — SHA `80eb2466`, PR #485
- statut: incertain
- valeur: L’intégration MCP Shopify était bloquée par une erreur d’authentification lors du dernier relevé. Son état actuel doit être retesté avant usage.
