# Leçons et incidents extraits de GitHub

Extraction du 2026-11-24. Les fiches retiennent les garde-fous durables, sans recopier de logs sensibles.

### F-001
- sujet: conflits de conteneurs pendant déploiement
- date: 2026-09-17
- source: `docs/VPS-DEPLOY-RUNBOOK.md:5-20,74-78` — SHA `733f98c6`
- statut: actif
- valeur: Des déploiements concurrents ont laissé un conteneur renommé bloquant la recréation. Le déploiement est sérialisé et ne supprime que les conteneurs arrêtés correspondant précisément au projet et au service.

### F-002
- sujet: interruption des feeds au déploiement
- date: 2026-10-26
- source: `docker-compose.yml:136-148` — SHAs `65ef029c`, `39e0d4bc`
- statut: actif
- valeur: `npx` en PID 1 ne transmettait pas correctement `SIGTERM`, transformant les déploiements en crashs de feed. Le worker lance désormais Node directement et dispose d’une longue période de drainage.

### F-003
- sujet: OOM des snapshots Galaxus
- date: 2026-10-29
- source: `docker-compose.yml:5-10,169-184` — SHA `276aa536`, PR #294
- statut: actif
- valeur: Les rebuilds de snapshots ont dépassé les anciennes limites mémoire, tandis que des plafonds trop élevés affamaient l’hôte. Les rôles web, feed et ops ont maintenant des budgets distincts.

### F-004
- sujet: divergence des formules Shopify
- date: 2026-11-19
- source: `docs/jarvis/memory/decisions.md:90-95` — SHA `80eb2466`, PR #485; PR #483
- statut: actif
- valeur: Une implémentation Python utilisait une formule différente de TypeScript et surévaluait les prix. La leçon durable est d’aligner toutes les voies de publication sur la formule du 19 août.

### F-005
- sujet: succès apparent avec snapshot obsolète
- date: 2026-11-23
- source: PR #499, SHA `a3ce0303`; `galaxus/ops/feedPipelineCore.ts:1009`
- statut: actif
- valeur: Un push peut réussir techniquement tout en utilisant un snapshot master/specs obsolète. La fraîcheur doit donc être contrôlée séparément du statut de push.

### F-006
- sujet: collisions produit lot et unité
- date: 2026-11-23
- source: `scripts/reprice-shopify-fast.ts:482-506` — SHA `d98c8060`, PR #501
- statut: actif
- valeur: Un reprice unitaire pouvait cibler un produit Shopify partagé par un lot. Un garde-fou de taille de lot doit précéder toute mise à jour de prix.

### F-007
- sujet: unités dupliquées au packing
- date: 2026-11-23
- source: `app/scan/page.tsx:897-899,1754-1759,1833-1837` — SHAs `0ddb456b`, `6e3df632`, PRs #500 et #502; `app/api/scan-awb/packing-session/route.ts:401-411` — SHA `0c2948d1`, PR #509
- statut: actif
- valeur: Des tailles identiques pouvaient masquer la seconde unité ou produire un rejet silencieux. Chaque unité doit avoir un index distinct et tout rejet doit être visible à l’opérateur.

### F-008
- sujet: achat payé sans numéro
- date: 2026-11-11
- source: `lib/stockxBuyer/policy.ts:190-199` — SHA `19e4b840`, PR #415
- statut: actif
- valeur: Si un paiement peut avoir eu lieu sans numéro de commande, le buyer ne réessaie jamais à l’aveugle. Il bloque le cas pour rapprochement humain.

### F-009
- sujet: preuve de stock trompeuse
- date: 2026-09-17
- source: `docs/SUPPLIER-STOCK-RECONCILIATION.md:1-7,43-56` — SHAs `aec249da`, `c997935d`
- statut: actif
- valeur: Les quantités historiques, valeurs par défaut et simples fins de run ont été confondues avec des preuves de page. Elles ne doivent jamais renouveler une quantité publiable.

### F-010
- sujet: branches longues
- date: 2026-09-23
- source: `docs/AUTO-PRINT-STATIONS.md:8-13` — SHA `cf8082f1`
- statut: actif
- valeur: Une branche de fonctionnalité ne suit pas automatiquement `main`; les protections de synchronisation ne la rebasent pas. Rejouer la branche sur `origin/main` avant PR évite un diff obsolète.
