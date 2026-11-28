# Module Entrepôt et Partenaires — contrats du lot 1

Contrat gelé pour le pilote (un partenaire, un site suisse, un site de test étranger, deux postes).
Toute modification passe par le coordinateur et met à jour ce fichier dans le même commit.

## 1. Frontières

| Zone | Chemin | Règle |
|---|---|---|
| Domaine | `lib/warehouse/*.ts` | Aucune importation de connecteur (Shopify, Galaxus, Decathlon, StockX, transporteur, EDI, e-mail). Test : `lib/warehouse/__tests__/isolation.test.ts`. |
| API interne | `app/api/warehouse/[...path]/route.ts` → `lib/warehouse/api/staff.ts` | Une ligne par route. Cookie staff vérifié par `proxy.ts` puis par le handler. |
| API partenaire | `app/api/partners/warehouse/[...path]/route.ts` → `lib/warehouse/api/partner.ts` | L'identifiant partenaire vient uniquement de la session signée. |
| Écrans internes | `app/warehouse/**` | Navigation « Entrepôt ». |
| Écrans partenaire | `app/partners/**` | Français, sans vocabulaire d'entrepôt. |
| Schéma | `prisma/schema.prisma` (modèles `Warehouse*`) + `prisma/migrations/20261128040000_warehouse_lot1` | Additif uniquement. Un seul auteur de migrations. |

Le module n'écrit dans aucune table existante (lecture seule de `Partner`, `KickDBVariant`,
`KickDBProduct`, `SupplierVariant`). Aucune publication sur un canal, aucune facture, aucun suivi.

## 2. Indicateurs de configuration

| Variable | Défaut | Effet |
|---|---|---|
| `WAREHOUSE_MODULE_ENABLED` | `false` | `false` : toutes les routes répondent 404 `MODULE_DISABLED`, la navigation est masquée. |
| `WAREHOUSE_WRITES_ENABLED` | `true` | `false` : lecture seule (`WRITES_DISABLED`, 503). Les données restent consultables. |
| `WAREHOUSE_PARTNER_ALLOWLIST` | vide = aucun | Clés partenaires autorisées à voir leur stock en dépôt, séparées par des virgules. `*` = tous. Un partenaire hors liste reçoit 404 `MODULE_DISABLED` et garde son portail actuel. |
| `WAREHOUSE_PILOT_SITES` | vide = tous | Codes des sites où du stock peut entrer. Hors liste : ouverture de lot et création de paire refusées (403 `SITE_NOT_IN_PILOT`) ; la consultation et la configuration restent possibles. |
| `WAREHOUSE_RESERVATION_TTL_MINUTES` | `480` | Durée de réservation d'une place proposée. |
| `WAREHOUSE_PRINT_CLAIM_TIMEOUT_SECONDS` | `90` | Délai avant qu'une impression prise sans réponse devienne « incertaine ». |
| `WAREHOUSE_LABEL_JOURNAL_DIR` | vide | Dossier du journal d'émission des QR, hors disque de la base. |
| `WAREHOUSE_LABEL_JOURNAL_ENFORCE` | `false` | `true` : une étiquette de paire n'est imprimée qu'après export de son entrée de journal. |
| `WAREHOUSE_STALE_TASK_HOURS` | `24` | Seuil d'alerte des rangements en attente. |

## 3. Identité et codes

- **Paire** : `WarehouseUnit.id` = UUID v4 opaque, permanent. Jamais réutilisé, jamais supprimé (déclencheur SQL).
- **QR de paire** : `<uuid>-<site d'émission>` (ex. `2f6c…-CH01`), 41 caractères, format `UUID_SITE_V1`.
  Le suffixe est le site d'émission, immuable ; il ne dit rien du site courant.
  Résolution par index unique `WarehouseLabelCode.code` (registre en ajout seul).
- **Référence courte** affichée : 8 premiers caractères du UUID (`XXXX-XXXX`), pour l'œil et la recherche ; jamais une identité.
- **Emplacement** : `CH01-A-R03-T02-N04` (site, secteur, rangée, travée, niveau) ; court : `A-03-02-4`.
  Spéciaux : `CH01-REC-01`, `CH01-CART-01`, `CH01-PACK-01`, `CH01-RET-01`, `CH01-QUA-01`.
  Un code renommé reste résoluble (alias).
- **GTIN** : identifie une variante, jamais une paire. Texte, zéros de tête conservés ; une valeur abîmée
  par un tableur (`1.98481E+11`) est refusée.
- **Référence externe** (ancienne étiquette, réf. partenaire) : alias de recherche uniquement. Un scan qui n'est ni un QR de paire, ni un emplacement, ni un GTIN est cherché parmi ces références : une seule paire = `UNIT` (`via: "EXTERNAL_REF"`), plusieurs = `EXTERNAL_REF_AMBIGUOUS` et choix explicite.

## 4. États d'une paire (dimensions séparées)

| Dimension | Valeurs |
|---|---|
| Présence | `PRESENT` · `IN_TRANSIT` · `THIRD_PARTY` · `MISSING` · `OUT` |
| Contrôle | `PENDING` · `PASSED` · `QUARANTINE` |
| Droit de vente | `STORAGE_ONLY` · `SALE_AUTHORIZED` · `BLOCKED` |
| Propriétaire | `OWN` · `PARTNER` (+ `ownerPartnerId`) · `UNKNOWN` |
| État physique | `NEW` · `USED` · `DAMAGED` · `UNKNOWN` ; boîte `GOOD` · `DAMAGED` · `MISSING` · `UNKNOWN` |

Vendable = `PRESENT` + `PASSED` + `SALE_AUTHORIZED` + variante active + accord actif autorisant la vente.
Aucune de ces conditions ne se déduit d'un QR, d'un GTIN ou d'un prix.

## 5. Règles d'écriture

1. Tout geste physique porte une **clé d'action** `opKey` générée par le client **une fois par action réelle**
   (8 à 120 caractères `[A-Za-z0-9:_.-]`). Renvoi de la même clé = même résultat (`replayed: true`),
   aucune seconde paire, aucun second mouvement, aucune seconde impression. Même clé avec un autre contenu = `OPKEY_REUSED`.
2. État courant et mouvement sont écrits dans la même transaction ; `version + 1` à chaque geste.
3. Capacité = occupé + réservé, contrôlée par mise à jour conditionnelle atomique. Jamais de surréservation.
4. Une erreur métier (`ok: false`) signifie que **rien n'a été écrit**.
5. Verrous : la paire d'abord, puis les emplacements par identifiant croissant.
6. L'historique (`WarehouseMovement`) est en ajout seul (déclencheur SQL) ; l'archivage passe par une routine dédiée.
7. Interrupteurs vérifiés dans le service, pas seulement dans la route : `WRITES_DISABLED` (503) pour toute écriture, `SITE_NOT_IN_PILOT` (403) pour toute entrée de stock.

## 6. API interne — `/api/warehouse/…`

Enveloppe : `{ ok: true, data }` ou `{ ok: false, error: { code, message, details } }`.
`message` est en français, affichable tel quel. En-têtes : `x-warehouse-operator: <jeton>` (opérateur identifié),
`x-warehouse-station: <id>.<secret>` (poste appairé).

Colonnes : **A** = réservé à l'administration ; **O** = geste physique (opérateur requis dès qu'un opérateur existe) ; **P** = poste appairé requis.

| Méthode | Route | | Corps / paramètres | Réponse (`data`) |
|---|---|---|---|---|
| GET | `config` | | | `{ role, flags, sites[], operators[], operatorId, station, labelProfiles }` |
| GET | `overview?site=CH01` | | | `Overview` (`lib/warehouse/overview.ts`) |
| GET | `reconciliation?siteId=` | | | stock reconstruit par site, propriétaire, état |
| GET | `scan?code=` | | | `ScanResolution` : `UNIT` · `LOCATION` · `GTIN` · `UNIT_CODE_UNKNOWN` · `LOCATION_UNKNOWN` · `EXTERNAL_REF_AMBIGUOUS` · `MANGLED_NUMBER` · `UNKNOWN` · `EMPTY` |
| GET | `operations/:opKey` | | | résultat enregistré d'une clé d'action (reprise après coupure) |
| GET/POST | `sites` · `sites/:id/status` | A (POST) | `{ code, name, countryCode, timezone?, isTest? }` | `SiteRow` |
| GET | `locations?siteId=&kinds=&status=&sector=&search=&onlyFree=&cursor=` | | | `{ items: LocationSummary[], nextCursor }` |
| GET | `locations/structure?siteId=` | | | `SiteStructure` |
| GET | `locations/:id` | | | `{ location, units[], hasMore }` |
| GET | `locations/labels?ids=a,b&format=pdf\|svg` | | | fichier PDF (une page par étiquette) |
| POST | `locations/generate` | A | `{ siteId, sector, rowFrom, rowTo, racksPerRow, levelsPerRack, capacityPerLevel, sizeProfile?, serpentine? }` | `{ created, skipped, levelCodes }` |
| POST | `locations/level` · `locations/special` | A | `{ siteId, sector, rowNo, rackNo, levelNo, capacity }` · `{ siteId, kind, number?, capacity?, label? }` | |
| PATCH | `locations/:id` | A | `{ capacity?, sizeProfile?, walkSequence?, shortCode? }` | `LocationSummary` |
| POST | `locations/:id/rename` | A | `{ newCode, newShortCode? }` | ancien code conservé en alias |
| POST | `locations/:id/status` | O | `{ status: ACTIVE\|BLOCKED\|RETIRED, reason? }` | libère les réservations |
| POST | `locations/print-labels` | | `{ opKey, locationIds[], stationId? }` | `{ queued, notQueued, jobs }` |
| POST | `locations/reconcile` | A | `{ siteId, fix? }` | écarts compteur / réalité |
| GET | `items/search?q=` · `items/catalog?q=` · `items/gtin?gtin=` · `items/:id` | | | variantes internes · candidats catalogue · `GtinResolution` |
| POST | `items` · `items/from-candidate` | O | `CreateItemInput` · `{ candidate }` | `{ item, created }` |
| GET | `units?siteId=&ownerKind=&ownerPartnerId=&presence=&qcState=&saleState=&itemId=&locationId=&batchId=&search=&cursor=&group=item` | | | `{ items: UnitSummary[], nextCursor }` ou agrégat par variante |
| GET | `units/export?…` | | | CSV |
| GET | `units/:id` | | | `UnitDetail` (codes, mouvements, tâche, prix, écarts, impressions) |
| GET | `units/:id/label?format=pdf\|svg` | | | étiquette 50 × 30 mm |
| POST | `units/:id/qc` · `sale` · `condition` · `owner` · `item` · `missing` · `out` · `relocate` · `reprint` · `confirm-label` · `external-ref` | O | `{ opKey, expectedVersion?, reason?, note?, … }` | `{ unit, opKey, replayed }` |
| GET/POST | `batches` | O (POST) | `CreateBatchInput` | `BatchRow` |
| GET | `batches/:id` | | | `BatchDetail` (`totals`, `lines`, `sessions`, `openSession`) |
| POST | `batches/:id/lines` · `status` · `close` | O | `{ lines[] }` · `{ action: PAUSE\|RESUME\|CANCEL }` · `{ reason? }` | |
| POST | `batches/:id/receive` | O | `{ opKey, itemId, lineId?, locationId?, condition?, boxCondition?, hold?, print? }` | `{ unit, print, taskId, line, exception }` |
| POST | `batches/:id/sessions` | O | `{ locationId, takeOver? }` | `{ session, resumed }` |
| GET | `sessions/:id` | | | `CountSessionView` |
| POST | `sessions/:id/create-unit` | O | `{ opKey, itemId, condition?, boxCondition?, ownerUncertain?, print? }` | `{ unit, print, countedInSession, exceptions }` |
| POST | `sessions/:id/scan-unit` | O | `{ opKey, unitId, confirmMove?, acknowledgeOwner? }` | `{ result, unit, countedInSession, message }` ; `CONFIRMATION_REQUIRED` + `details.confirm` |
| POST | `sessions/:id/close` | O | | `CloseSessionResult` |
| GET | `putaway?siteId=&batchId=&cartLocationId=` | | | `{ tasks: PutawayTaskView[], counts }` (ordre de marche) |
| POST | `putaway/propose` | O | `{ siteId, batchId?, cartLocationId?, unitIds? }` | `{ reserved, noSlot, remainingPending }` |
| POST | `putaway/confirm` | O | `{ opKey, unitId, locationId, acceptMismatch? }` | `{ result: MOVED\|ALREADY_THERE, unit, locationCode, deviated, remainingInScope }` ; `DESTINATION_MISMATCH`, `LEVEL_FULL` |
| POST | `putaway/reassign` · `cancel` · `level-full` | O | `{ opKey, unitId, reason }` · `{ opKey, locationId, note? }` | |
| GET/POST | `exceptions` · `exceptions/:id/resolve` | O (POST) | `{ status: RESOLVED\|DISMISSED, resolution, reason, proofRef? }` | `{ items, nextCursor, openByType }` |
| GET | `stations?siteId=` | | | `{ stations[], printers[], journal }` |
| POST/PATCH | `stations` · `stations/:id` · `stations/:id/pair` · `unpair` · `route` | A | `{ siteId, name }` · `{ labelKind, printerId, fallbackPrinterId? }` | `pair` renvoie `credential` une seule fois |
| POST | `stations/:id/test-print` | | `{ opKey, printerId }` | `PrintOutcome` |
| GET/POST/PATCH | `printers` · `printers/:id` · `printers/:id/verified` | A | `PrinterInput` | `PrinterRow` |
| GET | `print-jobs?siteId=&stationId=&status=&objectId=` · `print-jobs/:id/label` | | | `PrintJobRow[]` · PDF |
| POST | `print-jobs/:id/action` | O | `{ action: RETRY\|CANCEL\|REROUTE\|CONFIRM\|NOT_PRINTED\|MANUAL_SENT, printerId?, stationId? }` | `PrintJobRow` |
| GET/POST | `agent/me` · `agent/claim` · `agent/report` | P | `{ jobId, claimToken, outcome: SENT\|FAILED, error? }` | `claim` → `{ job \| null }` avec `pdfBase64` et `printer` |
| GET/POST/PATCH | `operators` · `operators/:id` · `operators/login` | A (écriture) | `{ operatorId, pin? }` | `login` → `{ operator, token }` |
| GET | `partners` · `partners/:id/agreements` | | | partenaires + compteurs + accord actif |
| POST | `partners/:id/agreements` | A | `AgreementInput` | nouvelle version, l'ancienne est close |
| GET | `prices?partnerId=&itemId=&only=UNPRICED\|PROPOSED\|PRICED` | | | `{ items: PartnerPriceRow[], nextCursor }` |
| POST | `prices/unit` | A | `{ opKey, unitId, publicPrice, sellerNet?, currency? }` | prix validé + décomposition |
| POST | `prices/stockx-proposal` | A | `{ opKey, partnerId, itemId, basisAmount, basisCurrency, basisRef, basisIncludesFees, basisObservedAt, factor? }` | propositions à valider, jamais appliquées seules |
| POST | `prices/:id/decide` | A | `{ decision: VALIDATE\|REJECT, note? }` | |
| GET/POST | `requests?partnerId=&status=` · `requests/:id/answer` | A (POST) | `{ response, status? }` | |
| GET/POST | `transfers` · `transfers/:id` · `transfers/:id/ship` · `transfers/receive` · `transfers/missing` | A / O | `{ fromSiteId, toSiteId }` · `{ opKey, unitId }` · `{ opKey, unitId, toLocationId }` | la paire garde son UUID et son QR |
| POST/GET | `imports/preview` · `imports/:id` · `imports/:id/apply` | | `{ kind: LOCATIONS\|BATCH_LINES, targetId, filename, csv }` | `ImportView` ; reprise sans doublon |
| GET/POST | `journal` · `journal/export` · `journal/reconcile` | A (reconcile) | `{ dryRun? }` | état du journal d'émission |

## 7. API partenaire — `/api/partners/warehouse/…`

| Méthode | Route | Réponse (`data`) |
|---|---|---|
| GET | `summary` | `PartnerStockSummary` — pas de montant « à recevoir » : aucun versement n'existe au lot 1 |
| GET | `units?search=&status=&itemId=&cursor=&group=item` | `{ items: PartnerUnitRow[], nextCursor }` ou groupé par modèle |
| GET | `units/export` | CSV du stock du partenaire |
| GET | `units/:id` | `PartnerUnitDetail` ; paire d'un autre partenaire ou inconnue = même `NOT_FOUND` |
| GET | `requests` | demandes du partenaire |
| POST | `requests` | `{ unitId?, type: PRICE_CHANGE\|DISCREPANCY\|OTHER, message, requestedPublicPrice? }` |

Champs jamais exposés au partenaire : code d'emplacement, opérateurs, postes, lots internes, marge,
autres partenaires, propriété d'autres paires. Statuts partenaire : `IN_TRANSIT` (En route),
`IN_CONTROL` (En contrôle), `STORED` (Stocké), `SALE_AUTHORIZED` (Vente autorisée), `BLOCKED` (Bloqué),
`CHECKING` (Vérification en cours), `OUT` (Sorti).

## 8. Impression

`QUEUED → CLAIMED → SENT → CONFIRMED` ; `FAILED` (rien envoyé, relançable) ; `UNCERTAIN` (prise sans réponse :
jamais renvoyée ni reroutée automatiquement) ; `CANCELLED`.

- Une tâche appartient à un poste ; le poste ne reçoit que ses tâches (`agent/claim` atomique).
- `SENT` = le spouleur local a accepté. La preuve physique est le **scan de l'étiquette** (`confirm-label` ou tout geste suivant sur la paire).
- Réimpression = nouvelle tâche avec motif, **même code**, jamais une nouvelle paire.
- Pas de route configurée = la paire existe, l'étiquette reste « à imprimer » (`NOT_QUEUED`) avec le message à afficher ; le PDF est disponible en repli.
- Adaptateurs : `QZ_TRAY` (impression silencieuse via le pont QZ Tray existant) et `PDF_MANUAL` (PDF ouvert par l'opérateur).

## 9. Prix (lot 1)

- Prix **par paire**, versionnés : `PROPOSED → VALIDATED | REJECTED`, l'ancien devient `SUPERSEDED`.
- Le partenaire consulte ; l'administration saisit et valide.
- Deux montants distincts, toujours nommés : **Prix public** et **Net pour vous**.
  `net = prix public − commission (taux × prix public) − frais fixes`, arrondi au centime, selon l'accord en vigueur.
- Mode « StockX × coefficient » : `montant StockX observé × coefficient` produit une **proposition**.
  Tant que l'accord indique `pricingBasisIs = UNCONFIRMED`, le résultat est proposé comme prix public
  et signalé « base à confirmer ». Jamais appliqué à une autre pointure, jamais sans date et référence de l'observation.
