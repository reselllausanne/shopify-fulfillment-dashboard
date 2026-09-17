# Second Mac — sync checklist

Repo path on this machine (example):

`/Users/theomanzinali/Code scrapping price `

WIP already saved: `origin/wip/second-mac-20260917` @ `5f1838f` — do **not** merge blindly into `main`.

## 1. Install `gh` + LaunchAgent (Terminal.app)

```bash
cd "/Users/theomanzinali/Code scrapping price "   # real path
git fetch origin
git switch -C main origin/main
chmod +x scripts/RUN-ONCE-MAC-SETUP.sh
./scripts/RUN-ONCE-MAC-SETUP.sh
gh auth login   # if needed
```

## 2. Confirm aligned to GitHub `main`

```bash
git pull --ff-only origin main
git rev-parse --short HEAD
# must match https://github.com/reselllausanne/shopify-fulfillment-dashboard (main)
```

## 3. Daily

- `resell-sync` / `resell-push` (after `source ~/.zshrc`)
- Feature branches from `main`; merge via PR

## 4. Optional leftovers (local only — never commit)

```text
galaxus/GDELR_*.xml
*.csv
retention-summary.md
tmp/
scripts/export-retention-files.ts   # optional archive later
scripts/shopify-retention-analysis.ts
```
