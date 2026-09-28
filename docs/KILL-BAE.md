# Kill BAE (Bächli)

BAE scraper is **deleted**. Master/offer feeds **skip** BAE.

Galaxus **stock delist is NOT automatic on merge/deploy**.

## Merge does

1. Scraper code removed (`baechli*` gone)
2. Runner rejects `shop=bae`
3. Master/offer skip BAE ProviderKeys
4. Stock feed does **not** force BAE → 0 until armed

## Dry-run (safe)

```bash
npx tsx scripts/kill-bae-galaxus-delist.ts
```

Prints: listing count, positive pushed/DB stock, sample providerKeys/GTINs, feed impact.

## Confirm apply (still no upload)

```bash
npx tsx scripts/kill-bae-galaxus-delist.ts --confirm=BAE_DELIST
```

Writes `tmp/bae-galaxus-delist-armed.json` + prints ops steps.

## Ops after review

1. Set `BAE_GALAXUS_STOCK_ZERO=1` on VPS
2. Recreate web (or deploy with env)
3. Upload Galaxus **stock** feed (BAE rows → QuantityOnStock=0)
4. Optional DB wipe:

```bash
npx tsx scripts/kill-bae-delete.ts --confirm=BAE_DELETE
```

HHV/SNL/NSO remain auto force-zero (separate from BAE gate).
