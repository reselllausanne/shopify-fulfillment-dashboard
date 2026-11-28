# Décisions et règles confirmées

Format strict (lu par Optimize). Une entrée = un bloc `### D-xxx`. Champs : `topic`, `date`, `source`, `status` (active|superseded), `value`.
`source` : fichier du dépôt, SHA de commit, ou id de chat Cursor (transcript `…/agent-transcripts/<id>/<id>.jsonl`).
Les volumes, stocks et commandes ne sont PAS ici : les lire dans leur source (voir `../SOURCES.md`).

### D-001
- topic: buyer.loss_tolerance
- date: 2026-11-04
- source: chat 2b1ef821-3cdd-434b-8520-9fb71d1bc2eb (message de Théo)
- status: superseded
- value: Pas d'achat à perte. Perte max 5 % si vraiment nécessaire. Toujours le dire quand un achat est refusé.

### D-002
- topic: buyer.loss_tolerance
- date: 2026-11-18
- source: commit 490667b1 « fix(buyer): loss 10% for all, Galaxus cap 400 (#477) »
- status: active
- value: Perte max 10 % pour tous, plafond Galaxus 400. Confirmé par Théo le 2026-11-20 (chat, 17:40).

### D-003
- topic: buyer.channel
- date: 2026-11-11
- source: chat 2b1ef821-3cdd-434b-8520-9fb71d1bc2eb
- status: active
- value: Achats uniquement sur StockX. Jamais de double achat. Jamais d'achat hors StockX.

### D-004
- topic: buyer.chrome
- date: 2026-11-20
- source: .cursor/rules/stockx-one-chrome.mdc
- status: active
- value: Un seul Chrome StockX (sur le VPS). Ne jamais tuer ni lancer Playwright dans le Chrome du Mac.

### D-005
- topic: galaxus.price_basis
- date: 2026-11-20
- source: .cursor/rules/galaxus-supplier-price.mdc
- status: active
- value: Revenu = prix d'achat que Galaxus nous paie. Aucune commission Galaxus à déduire. Le prix consommateur n'est pas notre revenu.

### D-006
- topic: galaxus.feed_price_cap
- date: 2026-10-12
- source: store Cursor perso galaxus-notes.md (appel Galaxus)
- status: active
- value: Retirer tous les produits > 300 CHF sauf LEGO.

### D-007
- topic: galaxus.suppliers_in_feed
- date: 2026-10-12
- source: store Cursor perso galaxus-notes.md
- status: superseded
- value: Reichelt : garder Nvidia + vendus ≥ 2 fois. BWZ : retirer après ~2026-10-18.

### D-008
- topic: galaxus.suppliers_in_feed
- date: 2026-11-11
- source: chat 15724a3a-3ccc-476c-935b-517f054d3559
- status: active
- value: Retirer complètement du feed alt, haw, exl, ven, wrk, fan, bae, bwz. Garder la data des scrapers, ne plus rien envoyer, jusqu'à l'année prochaine.

### D-009
- topic: galaxus.assortment
- date: 2026-11-02
- source: chat 2262734e-832f-4d32-9da7-f12339b979dc (message Galaxus)
- status: active
- value: Galaxus signale des articles hors catégories convenues (jouets, vélos, électronique, robotique). Catégories hors accord = à ne pas envoyer. Question ouverte : d'où viennent les nouveaux articles.

### D-010
- topic: galaxus.sell_price_floor
- date: 2026-09-19
- source: chat aa37fc82-1449-4574-b6da-c6e9aa86c3d0
- status: active
- value: Coûts sans frais de fulfillment : ~1 CHF/boîte + 0,60 CHF d'envoi, puis 12 % de marge dessus. Formule à figer sur le VPS.

### D-011
- topic: decathlon.offers
- date: 2026-08-24
- source: chat 252bbf4f-78d3-4305-b98c-e6d868124bd6
- status: active
- value: Retirer toutes les offres Decathlon, ne jamais les remettre en vente, pousser sur GitHub et VPS.

### D-012
- topic: shopify.margin_wellplayed
- date: 2026-08-23
- source: chat 33a960b1-27f5-4f5b-8741-8b5b61c7afa7
- status: active
- value: Ne toucher à aucun prix Reichelt. Well Played : marge au moins 15 % + 1 CHF fixe.

### D-013
- topic: shopify.sell_formula
- date: 2026-11-17
- source: commit 2b4ff88a « revert Shopify sell formula to the 19-Aug-2026 version (best conversion) » (#471)
- status: active
- value: Formule de prix Shopify = version du 19 août 2026.

### D-014
- topic: git.deploy
- date: 2026-11-20
- source: AGENTS.md, .cursor/rules/git-github-vps.mdc
- status: active
- value: GitHub main = seule vérité. Merge sur main → déploiement VPS automatique. Pas de hotfix sur le VPS. Docs/tests seuls ne déclenchent pas de déploiement.

### D-015
- topic: ops.timezone
- date: 2026-11-20
- source: AGENTS.md
- status: active
- value: Fuseau métier = Europe/Zurich.

### D-016
- topic: warehouse.lot1_scope
- date: 2026-11-28
- source: feuille de route « Module Entrepôt et Partenaires » remise par Théo (chat 35282c75-477c-4692-bb73-80e6febcc00c), docs/warehouse/README.md
- status: active
- value: Lot 1 Entrepôt = module additif, sans aucun effet Shopify / Galaxus / EDI / suivi / facturation. Migration de production, écritures canal et déploiement décidés par Théo, pas par l'agent. Recette uniquement sur base locale isolée. Les choix de conception du pilote (identité UUID + QR, états, prix) sont dans docs/warehouse/DECISIONS.md et restent à confirmer par Théo.
