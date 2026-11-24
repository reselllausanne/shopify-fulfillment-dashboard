# Procédures extraites de GitHub

Extraction du 2026-11-24. Procédures durables uniquement; aucune donnée de production n’est reproduite.

### F-001
- sujet: développement et partage des changements
- date: 2026-11-20
- source: `AGENTS.md:3-14` — SHA `80eb2466`, PR #485
- statut: actif
- valeur: Chaque sujet est développé sur une branche dédiée issue de `origin/main`, puis commité et poussé. La coordination entre machines passe par GitHub, pas par les copies locales.

### F-002
- sujet: déploiement normal
- date: 2026-10-12
- source: `docs/GITHUB-VPS-SYNC.md:40-62` — SHA `3be93e38`, PR #100; `.github/workflows/deploy-vps.yml:1-14` — SHA `1b783852`, PR #410
- statut: actif
- valeur: Un push sur `main` déclenche la validation puis le déploiement du SHA exact sur le VPS. Les changements limités aux docs, règles Cursor ou tests sont ignorés par le déploiement.

### F-003
- sujet: migrations de production
- date: 2026-09-17
- source: `docs/VPS-DEPLOY-RUNBOOK.md:60-73` — SHA `733f98c6`
- statut: actif
- valeur: Les migrations Prisma ne s’exécutent pas par défaut. Elles exigent l’option explicite `migrate`, après construction de l’image et avant remplacement de l’application.

### F-004
- sujet: validation après déploiement
- date: 2026-09-17
- source: `docs/VPS-DEPLOY-RUNBOOK.md:38-44` — SHA `733f98c6`
- statut: actif
- valeur: Vérifier que le SHA exécuté correspond au SHA demandé et que le service web est actif.

### F-005
- sujet: activation du contrôle de stock fournisseur
- date: 2026-09-17
- source: `docs/SUPPLIER-STOCK-RECONCILIATION.md:17-27` — SHA `c997935d`
- statut: actif
- valeur: Qualifier et valider un fournisseur à la fois en mode observation avant d’activer l’application des quantités. Ne jamais activer globalement sans fournisseur validé, sauf volonté explicite de publier zéro pour tous les non-approuvés.

### F-006
- sujet: qualification d’un scraper
- date: 2026-09-19
- source: `docs/SUPPLIER-OBSERVATION-QUALIFICATION.md:1-22` — SHA `c3adfe22`
- statut: actif
- valeur: Documenter exemples en stock, épuisé et précommande, signaux d’achat, source de prix, identité, quantité et exhaustivité. L’approbation attend l’émission effective d’une observation structurée.

### F-007
- sujet: impression des étiquettes
- date: 2026-09-23
- source: `docs/AUTO-PRINT-STATIONS.md:14-28` — SHA `cf8082f1`
- statut: actif
- valeur: Le backend crée fulfillment, DELR et PDF une seule fois; le navigateur imprime ensuite le PDF existant. Un échec d’impression ne doit jamais relancer les opérations métier.

### F-008
- sujet: réception des retours Decathlon
- date: 2026-07-19
- source: `README.md:194-220,256-278` — SHA `d142f575`
- statut: actif
- valeur: Synchroniser les retours ouverts, scanner l’étiquette, confirmer le contrôle physique, puis réceptionner, rembourser la ligne et clôturer dans Mirakl. Le mode simulation précède toute mutation réelle.

### F-009
- sujet: retour Shopify
- date: 2026-07-19
- source: `README.md:280-309,370-384` — SHA `d142f575`
- statut: actif
- valeur: Le flux ouvre et approuve la demande, génère l’étiquette Swiss Post, l’attache au retour et enregistre le suivi. Le personnel confirme ensuite la réception avant émission d’un avoir.

### F-010
- sujet: auto-achat StockX
- date: 2026-11-11
- source: `docs/STOCKX-BUYER.md:7-25,47-57` — SHA `19e4b840`, PR #415
- statut: actif
- valeur: Exécuter d’abord les rachats annulés, puis Shopify Express et les plus anciens, puis Galaxus, sous verrou unique. Utiliser le mode dry-run pour contrôler la sélection sans acheter.

### F-011
- sujet: preuve de scan des expéditions Galaxus
- date: 2026-11-24
- source: `galaxus/warehouse/unitScans.ts:3-10,40-79,106-123` — SHA `74de0c8f`, PR #510
- statut: actif
- valeur: Chaque unité d’une nouvelle expédition entrepôt Galaxus doit disposer d’un scan distinct correspondant à sa ligne. Le garde-fou s’applique à la création, au marquage expédié et au DELR; les expéditions historiques sans exigence enregistrée restent exemptées.
