# Auto-print per packing station

## Goal

Each packing desk prints Swiss Post labels on **its own** thermal printer
with a **shared label PDF** from the backend (VPS). Config is done in the
browser on that desk — via the **VPS-hosted** `/scan` page (not SSH).

## Why we fell behind `main`

Feature branches do **not** auto-rebase. `main` kept receiving other PRs
while this branch sat. `safe-sync` protects dirty trees; it does not keep
feature branches current. Fix: rebase/replay onto `origin/main` before PR.

## Rule

1. Backend creates the label / fulfillment / DELR once.
2. Browser prints that existing PDF (QZ silent or PDF popup).
3. Print failures **never** re-call fulfill / Swiss Post / DELR.

## Where to set paper size (per PC)

On the **production site** (VPS app) open `/scan` → **Configurer ce poste**
→ step **format** (presets, mm, DPI, margins, driver paper).

Stored in **that browser’s** `localStorage`. Theo’s Brother ≠ other thermal.

Quick path: **Activate** picks a printer and turns auto-print on (keeps
existing size from wizard if already set).

## QZ certificate (paid — silent, no popup)

Buy Premium Support (trusted cert, all machines):

- https://buy.qz.io/Premium-Support-_p_13.html — **$749 USD / year**
- Overview: https://qz.io/
- Generate cert after purchase: https://qz.io/docs/generate-certificate
- Signing docs: https://qz.io/docs/signing

Then on VPS `.env` (once):

```bash
QZ_PUBLIC_CERT="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
QZ_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Restart web. App signs **every** print via `/api/qz/sign` (SHA512).
Private key never reaches the browser.

## Multi-station

| What | Where |
|------|--------|
| Cert/key | VPS env (shared) |
| Printer + paper size + validated | each PC browser |
| QZ Tray app | each PC |

## Localhost

```bash
./scripts/setup-qz-local.sh
npm run dev
```
