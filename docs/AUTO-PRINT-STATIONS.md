# Auto-print per packing station

## Goal

Each packing desk prints Swiss Post labels on **its own** thermal printer
(Brother QL-W810, Zebra, …) with the **same 62×100 mm PDF format**.
Auto-print only on **certain** matches (never ambiguous).

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
  "autoPrintOnCertainMatch": true
}
```

Each operator picks their CUPS/QZ printer name once. Label bytes stay identical.

## Call chain

1. Scan resolves a **certain** match (single SKU+size+causal, or pinned line).
2. `decideStationAutoPrint({ matchCertainty: "certain", config })`.
3. `tryStationAutoPrint` → QZ Tray if available.
4. Else server `printLabelLocally` (CUPS) when `LOCAL_STATION=1`.
5. Else existing `SCAN_BROWSER_PRINT_*` popup.

## Multi-account StockX (later)

`StockxInboundPackage.stockxAccountKey` is ready for Galaxus-side StockX
accounts without changing Shopify AWB fallback today.
