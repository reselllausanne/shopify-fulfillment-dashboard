# Auto-print per packing station

## Goal

Each packing desk prints Swiss Post labels on **its own** thermal printer
(Brother QL-W810, Zebra, …) with a **shared label PDF** from the backend.
Auto-print only after the operator confirms a physical test on that machine.

## Rule

1. Backend creates the label / fulfillment / DELR once.
2. Browser prints that existing PDF (QZ silent or PDF popup).
3. Print failures **never** call `/fulfill-from-awb`, Swiss Post, Shopify, or DELR again.

## Localhost — one shot (no VPS, no deploy)

```bash
# from this worktree
ln -sfn ../../node_modules node_modules   # or: npm ci
./scripts/setup-qz-local.sh               # writes .env.local (gitignored)
npm run dev
```

1. Install [QZ Tray](https://qz.io/download/) on this Mac/PC + start it.
2. Open `http://localhost:3000/scan` → **Configurer ce poste**.
3. Name station → Reconnecter QZ → pick printer → format → test print → confirm.
4. Scan a real AWB (or use existing fulfill path) — silent print if ready, else PDF popup.

`setup-qz-local.sh` creates `QZ_PUBLIC_CERT` + `QZ_PRIVATE_KEY` in `.env.local`.
Private key never goes in Git. First QZ prompt: click **Allow**.

## Setup on each packing machine (after prod deploy — later)

1. Open `/scan` → **Configurer ce poste**.
2. Name the station (e.g. `Theo - maison`).
3. Install [QZ Tray](https://qz.io/download/) if needed → **Reconnecter / Vérifier QZ**.
4. Pick the local printer.
5. Choose label format (62×100 mm for Brother QL / Swiss Post).
6. **Imprimer un label de test** (local only).
7. Confirm **Le test est correct ?** → enables auto-print.

Prod silent print also needs server env `QZ_PUBLIC_CERT` + `QZ_PRIVATE_KEY`
(same values as local, or a fresh prod pair). Not required for PDF fallback.

## Status on /scan

Shows QZ, printer found/missing, station name, format, auto-print, validation.
Never shows “prêt” unless QZ is connected **and** the configured printer is found.

## After a successful scan

- Station valid → silent print of the existing PDF.
- Any local error → immediate browser PDF print dialog (same bytes).
- If that also fails → `Label créé — impression non confirmée` + **Réimprimer le même label**.
