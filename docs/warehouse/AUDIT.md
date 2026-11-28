# Lot 0 — Audit du dépôt avant le module Entrepôt

Audit en lecture seule du dépôt à `origin/main` `8306e4d5`, fait avant toute écriture.
Légende : **observé** = lu dans le code ou les migrations ; **déduit** = inférence d'architecture ; **à vérifier** = à confirmer sur la base ou le VPS réels.

## 1. Carte du code réutilisé

| Besoin du lot 1 | Existant réutilisé | Où | Ce que le module en fait |
|---|---|---|---|
| Session équipe | Cookie `auth_token` (JWT `jose`, rôles `admin` / `logistics` / `sav`) | `proxy.ts`, `app/lib/staffAuth.ts › getStaffRoleFromRequest` | Toute route `/api/warehouse/**` exige `admin` ou `logistics`. `sav` n'est pas un rôle entrepôt (401). Configuration et corrections sensibles : `admin` seulement. |
| Session partenaire | Cookie `partner_auth` (JWT, `partnerId`, `partnerKey`, `role`) | `app/lib/partnerAuth.ts › getPartnerSession` | `/api/partners/warehouse/**` : le `partnerId` vient **uniquement** de la session, jamais d'un paramètre. Partenaire inactif → 401. |
| Compte partenaire | `Partner` (`id`, `key`, `name`, `active`) | `prisma/schema.prisma` | Propriétaire d'une paire = `Partner.id`. Quatre clés étrangères, aucune colonne ajoutée à `Partner`. |
| Catalogue | `SupplierVariant` (GTIN, marque, modèle, taille), `KickDBVariant` / `KickDBProduct` | `prisma/schema.prisma` | Lecture seule pour proposer une variante à partir d'un GTIN (`lib/warehouse/items.ts › findCatalogCandidatesByGtin`). La variante retenue est copiée dans `WarehouseItem` : le stock physique ne dépend pas d'une ligne de flux qui peut disparaître. Aucune écriture dans le catalogue. |
| Navigation admin | `NAV_GROUPS` statique | `app/components/AppNav.tsx` | Groupe « Entrepôt » ajouté, affiché seulement si `GET /api/warehouse/config` répond 200 (module activé). |
| Portail partenaire | `app/partners/layout.tsx`, pages dropshipping | `app/partners/**` | Coque refaite en français (Accueil, Mon stock, Envois, Prix et canaux, Ventes et versements, Demandes et retraits). Les pages dropshipping existantes sont conservées telles quelles sous leurs URL. |
| Impression | QZ Tray signé (`/api/qz/certificate`, `/api/qz/sign`), profils d'imprimante en `localStorage` | `lib/qzSecurity.ts`, `lib/printStation.ts`, `app/scan/PrintStationWizard.tsx` | Même QZ Tray et mêmes routes de signature. Les postes et imprimantes de l'entrepôt sont en base (`WarehouseStation`, `WarehousePrinter`) pour router et tracer ; la file d'impression est côté serveur. |
| Codes-barres | `bwip-js` (GS1-128 SSCC Galaxus) | `galaxus/barcodes/barcode.ts` | Même bibliothèque pour le QR des paires et des niveaux (`lib/warehouse/labels.ts`). Aucune dépendance ajoutée. |
| Idempotence | `FulfillAttemptLock.idempotencyKey`, `InventoryEvent.idempotencyKey` | `lib/fulfillIdempotency.ts` | Même principe, généralisé : registre `WarehouseOperation` (clé de geste → résultat). |
| Conventions Prisma | `id` uuid texte, `Decimal` pour l'argent, états en `String`, `createdAt` / `updatedAt` | `prisma/schema.prisma` | Suivies. Les vocabulaires d'état sont verrouillés par des `CHECK` (extensibles sans migration d'`enum`). |
| Enveloppe d'API | `NextResponse.json({ ok, error })` | `app/api/**` | `{ ok: true, data }` / `{ ok: false, error: { code, message, details } }`. |
| Tests | `vitest` (environnement `node`) | `vitest.config.ts` | Tests unitaires + tests d'intégration sur un PostgreSQL local isolé (le dépôt n'avait pas de base de test). |
| Déploiement | Actions → VPS, `prisma migrate deploy` dans `scripts/vps-deploy-from-github.sh` | `.github/workflows/deploy-vps.yml` | Inchangé. La migration est additive ; elle part avec le déploiement normal quand la PR sera fusionnée. |

Ce qui n'existait pas et que le lot 1 crée : identité permanente d'une paire (UUID + QR), adresses (site / secteur / rangée / rack / niveau), lots de reprise et de réception, file de rangement, propriété par déposant, prix par paire, file d'impression tracée.

Ce qui existait sous un nom voisin et que le module **ne touche pas** : `ShopifyVariantLocationStock` (miroir des quantités Shopify), `LocalStockLot` (lots du stock propre avec coût), `WarehouseScanMiss` (journal des scans ratés de `/scan`), `ShipmentUnitScan` (preuve GTIN par unité des envois Galaxus), `/galaxus/warehouse` (expéditions Galaxus).

## 2. Points d'entrée ajoutés

| Entrée | Fichier | Accès |
|---|---|---|
| `GET|POST|PATCH /api/warehouse/**` | `app/api/warehouse/[...path]/route.ts` → `lib/warehouse/api/staff.ts` | Session équipe (`admin`, `logistics`) |
| `GET|POST /api/partners/warehouse/**` | `app/api/partners/warehouse/[...path]/route.ts` → `lib/warehouse/api/partner.ts` | Session partenaire |
| `/warehouse/**` (écrans) | `app/warehouse/**` | Session équipe (cookie vérifié par `proxy.ts`) |
| `/partners/**` (portail) | `app/partners/**` | Session partenaire |

`proxy.ts` n'est pas modifié : `/api/partners/**` y est public au niveau du proxy (comme les routes partenaires existantes) et chaque route vérifie la session ; `/api/warehouse/**` et `/warehouse/**` passent par la vérification du cookie équipe.

## 3. Effets de bord vers l'extérieur — état des lieux

Question posée : une écriture du module peut-elle modifier une quantité publiée, un prix, une commande, un suivi ou une facture ?

| Mécanisme existant | Se déclenche sur | Effet extérieur | Atteint par le module ? |
|---|---|---|---|
| Trigger `trg_propagate_shopify_mirror_to_listing_state` | `ShopifyVariantLocationStock` | Recalcule `ChannelListingState` | Non — table jamais écrite |
| Trigger `trg_enforce_shopify_listing_state_from_mirror` | `ChannelListingState` | Stock / statut Shopify | Non |
| Trigger + extension Prisma `supplierKey` | `VariantMapping`, `SupplierVariant` (écritures) | Colonne `supplierKey` | Non — lecture seule du catalogue, par SQL brut |
| Worker flux Galaxus (`worker-galaxus-feed`) | `SupplierVariant`, instantanés | CSV → SFTP Galaxus | Non |
| EDI Galaxus (ORDR, DELR, INVO) | Commandes et expéditions Galaxus | Messages EDI | Non |
| `applyInventoryOrderLine`, `scheduleMarketplaceStockPush` | `InventoryEvent`, `SupplierVariant.stock` | Poussée de stock multicanal | Non — jamais appelés |
| Webhooks Shopify, convergence d'inventaire | Événements Shopify | GraphQL inventaire | Non |
| `/api/scan-awb`, `/api/fulfill-from-awb`, Swiss Post | Requête de scan d'expédition | Étiquette, fulfillment, e-mail | Non — parcours distinct (`/scan` inchangé) |
| Rapprochement StockX (`OrderMatch`, crons AWB) | Achats StockX | Métachamps, liens | Non |
| Facturation partenaire (`partnerSalesInvoice`) | Calcul à la demande | PDF / export | Non |

Preuve automatique : `lib/warehouse/__tests__/isolation.test.ts`.

- Statique : les fichiers de `lib/warehouse/**` n'importent que le module lui-même, `@prisma/client`, `next/server`, `jose`, `bwip-js`, `node:crypto|fs|path` et les deux helpers de session ; aucun `fetch`, aucune mention de connecteur, aucune variable d'environnement hors `WAREHOUSE_*` / `JWT_SECRET` ; **toutes** les cibles `INSERT` / `UPDATE` / `DELETE` du module sont des tables `Warehouse*`.
- Dynamique : un parcours complet (réception → étiquette → rangement → contrôle → droit de vente → prix → demande partenaire → clôture) ne modifie de lignes que dans des tables `Warehouse*` (compteurs `pg_stat_*` avant / après).

Le prix « StockX × coefficient » du lot 1 est un **calcul** sur un montant saisi ou importé par l'équipe ; le module n'appelle pas StockX.

## 4. Constats faits pendant l'audit, hors périmètre du lot

À traiter séparément ; aucun n'est modifié par cette PR.

| # | Constat | Risque | Suite proposée |
|---|---|---|---|
| R1 | **Aucune table `public` de production n'a de RLS** (138 tables) et le rôle `anon` de l'API de données a `SELECT` sur `Partner` (observé via les conseils de sécurité Supabase, en lecture). | Lecture possible par l'API de données si la clé publique circule. | Activer RLS sans politique sur les tables existantes, ou fermer l'API de données. Les 32 tables du module naissent avec RLS activé et sans politique. |
| R2 | Connexion partenaire rapide (`/api/partners/auth/quick`) sans code d'accès tant que `PARTNER_ACCESS_<KEY>` n'est pas défini. | Qui connaît la clé d'un partenaire ouvre son portail — donc, désormais, son stock. | Définir `PARTNER_ACCESS_<KEY>` pour chaque partenaire **avant** d'ajouter sa clé à `WAREHOUSE_PARTNER_ALLOWLIST`. |
| R3 | Pas de tests ni de lint en CI sur les PR (`build-image.yml` et `deploy-vps.yml` seulement). | Une régression passe si personne ne lance `npm test`. | Ajouter un workflow PR (`npm test`, `tsc`). Les tests d'intégration du module ont besoin d'un PostgreSQL de service. |
| R4 | `LOGISTICS_ALLOWED_PATHS` défini dans `proxy.ts` mais jamais utilisé : le rôle `logistics` atteint presque toutes les routes. | Périmètre du rôle plus large que prévu. | Hors lot. Le module, lui, sépare `admin` / `logistics` route par route. |
| R5 | L'historique des migrations n'est pas rejouable depuis zéro (base vide). | Pas de base de test « à l'identique » sans contournement. | `scripts/warehouse/setup-test-db.mjs` construit la base de référence par `db push` du schéma actuel sans le module, puis applique la migration du module par `migrate deploy` — le chemin exact de la production. |
| R6 | Un seul `.env` ; un script local lancé avec l'URL de production écrit en production. | Recette lancée par erreur sur la production (cas C25). | Tous les scripts du module refusent une URL qui n'est pas `127.0.0.1` / `localhost`. |

## 5. Environnements utilisés pour ce lot

| Usage | Base | Données |
|---|---|---|
| Tests d'intégration | PostgreSQL 17.6 local, `warehouse_vitest` | Synthétiques, créées par les tests |
| Démonstration des écrans | PostgreSQL local, `warehouse_test` | Jeu de démonstration (`scripts/warehouse/seed-demo.ts`) |
| Recette de charge et de restauration | Grappe PostgreSQL locale séparée, `warehouse_scale` | Synthétiques (`scripts/warehouse/scale-seed.ts`) |
| Production | — | **Non touchée.** Aucune migration, aucune écriture, aucun secret copié dans le worktree. |

Version de PostgreSQL identique à la production (17.6), binaires installés hors du dépôt (`~/.cache/resell-warehouse-pg`), `package.json` et image Docker inchangés.
