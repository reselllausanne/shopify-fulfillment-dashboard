# Kill BAE (Bächli)

BAE is **deleted**: no scraper, no master/offer, stock feed forces `QuantityOnStock=0`.

## Merge does

1. Scraper code removed (`baechli*` files gone)
2. Master/offer skip BAE
3. **Stock feed emits 0** for every BAE ProviderKey still in candidates (delist on next stock upload)

## After merge — ops

1. Upload Galaxus **stock** feed (BAE rows → 0)
2. Delete DB rows:

```bash
npx tsx scripts/kill-bae-delete.ts                 # counts
npx tsx scripts/kill-bae-delete.ts --confirm=BAE_DELETE
```

Remove `BAE|...|bae` from VPS `SCRAPER_SHOPS` if still present (parser ignores it anyway).
