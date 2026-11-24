# Questions ouvertes issues de GitHub

Extraction du 2026-11-24. Maximum contractuel: 15 questions.

### F-001
- sujet: exemption LEGO au plafond Galaxus
- date: 2026-11-16
- source: `docs/jarvis/memory/decisions.md:42-47` — SHA `80eb2466`, PR #485; `galaxus/exports/assortmentPolicy.ts:35-38` — SHA `a4898474`, PR #465
- statut: incertain
- valeur: LEGO est-il encore exempt du plafond de 300 CHF? D-006 dit oui, le code courant dit non.

### F-002
- sujet: source de la règle de revenu Galaxus
- date: 2026-11-23
- source: `docs/jarvis/memory/decisions.md:35-40` — SHA `80eb2466`, PR #485
- statut: incertain
- valeur: D-005 cite `.cursor/rules/galaxus-supplier-price.mdc`, absent de `main`. Faut-il restaurer cette source ou remplacer la référence par le code `galaxus/orders/margin.ts`?

### F-003
- sujet: expiration des fournisseurs Galaxus désactivés
- date: 2026-11-11
- source: `docs/jarvis/memory/decisions.md:56-61` — SHA `80eb2466`, PR #485; PR #434
- statut: incertain
- valeur: « Jusqu’à l’année prochaine » n’a pas de date d’expiration exacte. Quelle date et quel critère autorisent une réévaluation?

### F-004
- sujet: formule de plancher Galaxus
- date: 2026-09-19
- source: `docs/jarvis/memory/decisions.md:70-74` — SHA `80eb2466`, PR #485
- statut: incertain
- valeur: D-010 indique que la formule reste « à figer sur le VPS ». Quelle implémentation et quel commit constituent aujourd’hui la référence?

### F-005
- sujet: validation des contrats fournisseurs
- date: 2026-09-19
- source: `inventory/supplierStock/contractRegistry.ts:35-52,58-72` — SHA `ce607c86`; `docs/SUPPLIER-OBSERVATION-QUALIFICATION.md:25-44` — SHA `c3adfe22`
- statut: incertain
- valeur: Sept scrapers émettent désormais le contrat, mais le registre les laisse tous non validés humainement et la documentation est partiellement obsolète. Quels fournisseurs ont réellement passé la qualification live?

### F-006
- sujet: pilote partenaire Galaxus
- date: 2026-08-06
- source: `docs/partner-galaxus-self-fulfill-pilot-checklist.md:1-24` — SHA `37a203f6`
- statut: incertain
- valeur: Le dépôt contient le pilote et ses tests, mais pas de décision attestant son activation commerciale. Est-il actif, limité ou abandonné?

### F-007
- sujet: application du contrôle de stock fournisseur
- date: 2026-09-17
- source: `docs/SUPPLIER-STOCK-RECONCILIATION.md:8-27` — SHA `c997935d`
- statut: incertain
- valeur: Le mode dépend d’un drapeau d’environnement absent du dépôt. Est-il encore observation-only en production?

### F-008
- sujet: Shopify MCP Cursor
- date: 2026-11-20
- source: `docs/jarvis/SOURCES.md:27-34` — SHA `80eb2466`, PR #485
- statut: incertain
- valeur: L’erreur d’authentification MCP Shopify est-elle résolue depuis le dernier test?

### F-009
- sujet: activation sGTM
- date: 2026-10-19
- source: `docker-compose.yml:220-259` — SHA `beff9170`, PR #154
- statut: incertain
- valeur: Le profil sGTM est optionnel dans Compose. Est-il activé en production et fait-il foi pour le tracking?
