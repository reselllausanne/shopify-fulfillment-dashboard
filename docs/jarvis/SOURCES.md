# Resell Lausanne — carte des sources (Jarvis)

Généré 2026-11-20 depuis le MacBook Air de Théo. Rien de volumineux n'est copié ici : les données restent dans leur système, lues à la demande via `docs/jarvis/bin/jarvis`.
Aucun secret dans ce fichier. Clés : `.env` du VPS (conteneur `web`) et `~/secrets/` sur le Mac.

Statut : OK = lecture testée avec une vraie requête le 2026-11-20. KO = bloqué. NON = pas branché.

## Sources de vérité par sujet

| Sujet | Source qui fait foi | Lecture | Statut | Fraîcheur constatée |
|---|---|---|---|---|
| Code backend | GitHub `reselllausanne/shopify-fulfillment-dashboard` branche `main` (public) | `gh`, `git` | OK | main = `631b8dfc` 2026-11-20 |
| Code déployé | VPS `/opt/resell` (déploiement seulement) | `jarvis vps` | OK | HEAD = `631b8dfc` = main |
| Stock fournisseur, prix, listings | Postgres Supabase (tables `SupplierVariant`, `ChannelListingState`, `ShopifyVariantLocationStock`) | `jarvis sql` | OK | `SupplierVariant` màj 2026-11-20 16:28 (3,27 M lignes) |
| Commandes Shopify | Shopify Admin API (fait foi, depuis 2025) ; miroir DB `ShopifyOrder` (depuis 2026-01-01) | `jarvis shopify-orders`, `jarvis sql` | OK | API : 6 770 commandes au total ; DB : 3 017, dernière 2026-11-20 08:44 |
| Commandes Galaxus | DB `GalaxusOrder`, `GalaxusOrderLine`, `GalaxusEdiFile` | `jarvis sql` | OK | 2 826 commandes, dernière 2026-11-20 14:49 |
| Feed Galaxus | DB `GalaxusFeedRun`, snapshots `GalaxusFeed*` ; SFTP Galaxus (non lu) | `jarvis sql` | OK (DB) / NON (SFTP) | dernier run 2026-11-20 16:20 |
| Commandes Decathlon | DB `DecathlonOrder*` ; API Mirakl | `jarvis sql`, `jarvis decathlon-ping` | OK | API v3.1327 répond ; 421 commandes, dernière 2026-09-07 (offres retirées 2026-08-24) |
| Achats StockX / fulfillment | DB `StxPurchaseUnit`, `StockxInboundPackage`, `OrderMatch`, `Shipment*` | `jarvis sql` | OK | 2 761 unités, dernière 2026-11-20 14:44 |
| Sync stock nocturne | DB `InventorySyncRun` | `jarvis sql` | OK | dernier SUCCESS 2026-11-20 16:15 ; FAILED 2026-11-19 00:15 |
| Google Ads | API Google Ads (compte 6261619509 « Resell_lausanne ») ; miroir DB `DailyAdSpend`, `ads_*` | `jarvis gads`, `jarvis sql` | OK | 7 j : 4 506 clics, 2 137 CHF ; `DailyAdSpend` jusqu'au 2026-11-19 |
| Search Console | API GSC `sc-domain:resell-lausanne.ch` (compte de service, lecture) | `jarvis gsc`, `bin/gsc_sites.py top 7` | OK | données jusqu'à J-2 |
| Thème / site marchand | GitHub `reselllausanne/resell-lausanne.ch` (public) ; copie locale `~/Projects/resell-lausanne.ch` (46 fichiers modifiés non commités) | `git` | Partiel | dernier commit local 2026-11-16 ; état Shopify live non lu |
| App Shopify (cart transform, checkout) | GitHub privé `reselllausanne/allin-one-app` ; copie locale `~/Projects/allin-one-app` | `gh`, `git` | OK | dernier push 2026-10-14 |
| Rapprochement mails StockX/Shopify | GitHub privé `reselllausanne/mail_fetcher_llm` | `gh` | OK (code seul) | 2025-04 (ancien) |
| Autres dépôts | `stockx-shopify-matcher`, `Galaxus-connetion` (publics, anciens) | `gh` | OK | 2026-01 ; probablement remplacés par le dépôt principal |
| Documentation métier | `docs/*.md`, `AGENTS.md`, `.cursor/rules/*.mdc` dans le dépôt principal | fichiers | OK | rules 2026-11 |
| Notes Galaxus (décisions d'appel) | Store Cursor perso `…/u169396226/files/galaxus-notes.md` | fichier | OK | 2026-10-12 |
| Anciens chats Cursor | `~/.cursor/projects/…/agent-transcripts/*.jsonl` (426 chats, Aug–Nov 2026) | fichiers | OK | jusqu'au 2026-11-20 |
| Variables d'environnement | `.env` VPS (fait foi) ; `.env` Mac (copie locale, jamais lue en clair) | noms seulement | OK | — |
| Ahrefs | MCP `cursor1` (SEO) | MCP | Non testé (hors périmètre données internes) | — |
| Shopify MCP Cursor | plugin Shopify | MCP | KO | erreur d'auth : « Protected resource … does not match expected » |

## Hors périmètre (volontairement)

- Tables `health_*` (données de santé personnelles) : refusées par `jarvis sql`.
- `StockXToken`, `PartnerUser` : refusées (identifiants).
- Dossiers étrangers à Resell : `Antoine-carrelage`.
- Exports de production : jamais poussés sur GitHub.

## Garde-fous de `jarvis sql`

- SSH vers `resell-vps`, URL base lue dans le conteneur, jamais affichée.
- Session `default_transaction_read_only=on`, timeout 30 s, mots d'écriture refusés. Ce sont des garde-fous côté client : le rôle Postgres lui-même a encore les droits d'écriture (voir « manque »).

## Écarts connus entre sources

- Shopify API 6 770 commandes vs DB 3 017 : normal, la DB ne commence qu'au 2026-01-01.
- Plusieurs worktrees locaux `~/Projects/sfd-*` : copies de travail, pas des sources.
- Le dépôt GitHub principal est public alors que le brief parlait de dépôts privés (voir registre Optimize O-001).
