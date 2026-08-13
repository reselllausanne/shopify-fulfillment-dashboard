# Ads Explorer systemd templates

Templates only. Do **not** enable/install timers before first batch activation.

## Units

- `resell-ads-sync.service` / `.timer` : daily Ads backfill + validate
- `resell-ads-inventory-sync.service` / `.timer` : daily inventory snapshot
- `resell-ads-explorer-monitor.service` / `.timer` : every 6h explorer monitor
- `resell-ads-explorer-reconcile.service` / `.timer` : every 6h reconciler (metric sync → rules → Merchant → readback → DB commit)
- `resell-ads-explorer-watchdog.service` / `.timer` : stale-data watchdog

All units assume repo path `/opt/resell` and dockerized app user with `.env` loaded.
