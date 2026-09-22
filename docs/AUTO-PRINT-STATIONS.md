# Auto-print per packing station

## Goal

Each packing desk prints Swiss Post labels on **its own** thermal printer
(Brother QL-W810, Zebra, …) with the **same 62×100 mm PDF format**.
Auto-print only on **certain** matches (never ambiguous).

## Modes (what you asked for)

| Where | Path | Popup? |
|-------|------|--------|
| **Localhost packing Mac** (`LOCAL_STATION=1`) | Server `lp` → Brother CUPS queue | **No** — silent auto-print. QZ UI hidden. |
| **VPS / remote browser + QZ Activate'd** | QZ Tray silent | **No** |
| **VPS / remote, no QZ** | Browser print dialog | Yes |

## Call chain

1. Scan resolves a **certain** match.
2. Server CUPS when `LOCAL_STATION=1` → `printJobResult.ok && !skipped` → client **stops** (no dialog).
3. Else client `tryStationAutoPrint` → QZ if Activate'd + validated → silent.
4. Else browser print dialog (`SCAN_BROWSER_PRINT_*`).

## Local setup (cable Brother, no QZ)

```bash
# packing Mac .env — never on VPS
LOCAL_STATION=1
SWISS_POST_PRINTER_NAME="Brother_QL_810W"
# optional media / scale — see SWISS_POST_PRINT_*
```

Badge on `/scan`: **Print: CUPS**. Restart Next after changing `.env`.

If CUPS fails (`ok:false` / misconfigured queue), client falls through to browser dialog so you still get a label.

## QZ (remote stations only)

Default **QZ: off**. Nothing connects until **Activate**.

Silent only when:

1. Activate'd (`autoPrintOnCertainMatch` + `silentPrintValidated` in `localStorage.resell.printStation.v1`)
2. `window.qz` websocket active

**Off** → browser popup again. Page load never `connect()` while off.

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

## First-time QZ checklist (Brother QL-W810)

- [ ] Install QZ Tray on the station.
- [ ] Import signed cert / allow this origin without prompt.
- [ ] Brother drivers + 62×100 media.
- [ ] Self-test label from printer.
- [ ] QZ demo print → correct roll.
- [ ] Scan page pill **ready** → scan certain match → silent, no popup.
- [ ] Then set `silentPrintValidated: true`.

## Multi-account StockX (later)

`StockxInboundPackage.stockxAccountKey` is ready for Galaxus-side StockX
accounts without changing Shopify AWB fallback today.
