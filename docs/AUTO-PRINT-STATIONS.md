# Auto-print per packing station

## Goal

Each packing desk prints Swiss Post labels on **its own** thermal printer
(Brother QL-W810, Zebra, …) with a **shared label PDF** from the backend.
Auto-print only after the operator confirms a physical test on that Mac.

## Rule

1. Backend creates the label / fulfillment / DELR once.
2. Browser prints that existing PDF (QZ silent or PDF popup).
3. Print failures **never** call `/fulfill-from-awb`, Swiss Post, Shopify, or DELR again.

## Setup on each Mac (no Terminal)

1. Open `/scan` → **Configurer ce poste**.
2. Name the station (e.g. `Theo - maison`).
3. Install [QZ Tray](https://qz.io/download/) if needed → **Reconnecter / Vérifier QZ**.
4. Pick the local printer.
5. Choose label format (62×100 mm for Brother QL / Swiss Post).
6. **Imprimer un label de test** (local only).
7. Confirm **Le test est correct ?** → enables auto-print.

Optional for silent mode without prompts: set server env `QZ_PUBLIC_CERT` + `QZ_PRIVATE_KEY`
(private key never in the browser). Without them, QZ may prompt or fall back to PDF popup.

## Status on /scan

Shows QZ, printer found/missing, station name, format, auto-print, validation.
Never shows “prêt” unless QZ is connected **and** the configured printer is found.

## After a successful scan

- Station valid → silent print of the existing PDF.
- Any local error → immediate browser PDF print dialog (same bytes).
- If that also fails → `Label créé — impression non confirmée` + **Réimprimer le même label**.
