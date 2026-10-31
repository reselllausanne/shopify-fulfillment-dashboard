# Ads Explorer systemd templates

Templates only. Do **not** enable/install timers before first batch activation.

## Units

- `resell-ads-sync.service` / `.timer` : daily Ads backfill + validate
- `resell-ads-inventory-sync.service` / `.timer` : daily inventory snapshot
- `resell-ads-explorer-monitor.service` / `.timer` : every 6h explorer monitor
- `resell-ads-explorer-reconcile.service` / `.timer` : every 6h reconciler (metric sync → rules → Merchant → readback → DB commit)
- `resell-ads-explorer-watchdog.service` / `.timer` : stale-data watchdog
- `resell-ads-explorer-brand-cycle.service` / `.timer` : every 6h, starts the next Nike/Jordan/Adidas Explorer round for any brand without an open batch
- Set `ADS_EXPLORER_PAUSE_NEW_BATCHES=1` on the VPS to freeze new weekly/brand Explorer batches (default = run).
- Failed Explorer exits (zombie ≥50 imps / inconclusive) use `custom_label_3=ads_excluded`. Starved (&lt;50 imps) return to core. After deploy, extend core exclusions once: `npm run ads -- explorer:core-exclusions:extend --label=ads_excluded` (and `pmax:exclude-routed-labels` for PMax trees).

All units assume repo path `/opt/resell` and dockerized app user with `.env` loaded.
