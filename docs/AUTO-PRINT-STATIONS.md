# Auto-print per packing station

## Goal

Each packing desk prints Swiss Post labels on **its own** thermal printer
(Brother QL-W810, Zebra, …) with the **same 62×100 mm PDF format**.
Auto-print only on **certain** matches (never ambiguous), and only after
silent print has been physically validated on that station.

## Recommended stack: QZ Tray

| Option | Pros | Cons |
|--------|------|------|
| **QZ Tray** (chosen) | Local websocket, silent signed print, works offline, per-station printer pick | Needs desktop install + cert for silent mode |
| PrintNode | Central API, multi-site | Cloud hop, subscription |
| CUPS `lp` (existing) | Already on packing Mac via `LOCAL_STATION` | Server-bound; not per-browser station |
| Browser popup | Always available | Manual / popup blockers |

**Decision:** wire **QZ Tray** as the primary client path; keep **CUPS** when the
request hits a `LOCAL_STATION` packing Mac; fall back to **browser print** when
both are unavailable.

## Honesty contract (READ BEFORE ENABLING)

The scan page will refuse to silent-print unless BOTH:

1. `silentPrintValidated: true` is set on the station config
   (`localStorage.resell.printStation.v1`).
2. `window.qz` exists and its websocket is active on `localhost`.

Defaults ship with `autoPrintOnCertainMatch: false` and
`silentPrintValidated: false`. This is on purpose: we would rather show a
browser popup on every scan than silently drop labels because QZ died at
02:00.

## Per-station config

Stored in `localStorage` key `resell.printStation.v1` (`lib/printStation.ts` /
`app/lib/printStationClient.ts`):

```json
{
  "stationId": "desk-1",
  "provider": "qz_tray",
  "printerName": "Brother_QL_W810W",
  "labelWidthMm": 62,
  "labelHeightMm": 100,
  "autoPrintOnCertainMatch": true,
  "silentPrintValidated": true
}
```

Each operator picks their CUPS/QZ printer name once. Label bytes stay identical.

## First-time silent-print validation checklist (Brother QL-W810)

Run through every step on the physical station before flipping
`silentPrintValidated` to `true`:

- [ ] Install QZ Tray on the station (macOS or Windows).
- [ ] Import the signed cert into QZ Tray so silent print is allowed
      (Preferences → Site Manager → allow this origin without prompt).
- [ ] Install Brother QL-W810 drivers + `62×100 mm` media label profile.
- [ ] Print a self-test label directly from the printer.
- [ ] Print a Swiss Post PDF via QZ from a terminal / QZ demo page — confirm
      it comes out on the correct 62×100 label without a print dialog.
- [ ] Open the scan page. The QZ status pill must read **ready** (green).
- [ ] Scan a known certain match → confirm label prints silently and no
      popup appears.
- [ ] Only now, in the station settings, flip `silentPrintValidated` to
      `true` and save.

If ANY step fails, leave `silentPrintValidated: false`. The station will
fall through to the browser popup instead of dropping labels.

## Call chain

1. Scan resolves a **certain** match (single SKU+size+causal, or pinned line).
2. `decideStationAutoPrint({ matchCertainty: "certain", config })`.
3. `tryStationAutoPrint` → QZ Tray if available AND validated.
4. Else server `printLabelLocally` (CUPS) when `LOCAL_STATION=1`.
5. Else existing `SCAN_BROWSER_PRINT_*` popup.

## Multi-account StockX (later)

`StockxInboundPackage.stockxAccountKey` is ready for Galaxus-side StockX
accounts without changing Shopify AWB fallback today.
