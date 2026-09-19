# Kill BAE (Bächli)

BAE is removed from scraping and from **future** Galaxus master/offer feeds.

## What merge/deploy does NOT do

- Does **not** zero the ~9k live Galaxus BAE offers
- Does **not** upload a stock feed
- Does **not** set `SUPPLIER_STOCK_PUBLISH_ENFORCED`

## Dry-run (read-only)

Lists every Galaxus `ChannelListingState` row for BAE that is still `ACTIVE` or has `lastPushedStock > 0`:

```bash
npx tsx scripts/kill-bae-galaxus-delist.ts
npx tsx scripts/kill-bae-galaxus-delist.ts --out=tmp/bae-active.json
```

Output includes `total`, `byStatus`, and a sample of `providerKey` + `gtin`.

## Apply (explicit, after human validation)

```bash
npx tsx scripts/kill-bae-galaxus-delist.ts --apply --confirm=BAE_DELIST_GALAXUS
```

Apply:

1. Writes `tmp/bae-galaxus-delist-stock-<ts>.csv` (`ProviderKey,QuantityOnStock=0`)
2. Sets local `SupplierVariant.stock = 0` for listed `bae_*` rows
3. Marks matching Galaxus `ChannelListingState` as `SOLD_OUT` / `lastPushedStock=0`
4. **Does not upload** — upload the CSV via the normal Galaxus stock feed path after review

Wrong/missing `--confirm` → exit 2, no writes.
