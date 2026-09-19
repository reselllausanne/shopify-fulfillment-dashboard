# Supplier observation qualification checklist

Use **one supplier at a time**. Do not approve until every row is filled and the scraper emits `SupplierVariantObservation`.

Template (copy per supplier):

| Field | Value |
|-------|--------|
| supplierKey | |
| observationContractImplemented | false → true after code wired |
| Example URL **in-stock** | |
| Example URL **OOS** | |
| Example URL **preorder/backorder** (if any) | |
| Exact purchase signal | e.g. `add_to_cart`, `schema_InStock`, `Stück an Lager` |
| Exact qty available? | yes (field/path) / no → `quantityUnknown` |
| Price source | selector / JSON path |
| Lead time source | |
| Identity | GTIN / SKU / MPN (+ which wins) |
| Full snapshot possible? | yes / no + why |
| Pagination / categories complete? | |
| Cloudflare / bot wall? | |
| Notes | |

## Current status (code registry)

All scrapers: **pending** (`observationContractImplemented=false`).

| Key | Name | Contract |
|-----|------|----------|
| wel | WellPlayed | pending |
| rei | Reichelt | pending |
| bae | Bächli | **killed / deleted** — scraper removed; stock feed force-zeros; DB purge via `scripts/kill-bae-delete.ts` |
| fan | FantasyWelt | pending |
| exl | Ex Libris | pending |
| haw | Hawk | pending |
| wrk | Warenkontor | pending |
| bwz | Baby-Walz | pending |
| tus | The Uncommon Shop | pending |
| alt | Alternate | pending |
| ven | Venova | pending |
| hhv | HHV | pending |
| snl | Snowleader | pending |
| nso | Newsole | pending |

Finalize hooks / call sites ≠ page proof. Register adapter + set registry flag only after live qualification.
