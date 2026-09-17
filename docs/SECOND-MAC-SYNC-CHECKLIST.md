# Second Mac — sync checklist

Repo path on this machine (example):

`/Users/theomanzinali/Code scrapping price `

WIP already saved: `origin/wip/second-mac-20260917` @ `5f1838f` — do **not** merge blindly into `main`.

## 1. Install `gh`

```bash
export PATH="$HOME/.local/bin:$PATH"
# or: brew install gh
gh auth login
gh auth status
```

## 2. Align to GitHub `main`

```bash
cd "/Users/theomanzinali/Code scrapping price "   # real path

git fetch origin --prune
git status -sb

# Tracked must be clean (WIP already pushed). Leftover ?? tmp/csv/xml OK.
git switch -C main origin/main
git pull --ff-only origin main

git rev-parse --short HEAD
# expect same SHA as GitHub main (see Mac principal / github.com)
```

## 3. Install safe-sync LaunchAgent

```bash
chmod +x scripts/safe-sync.sh scripts/safe-push.sh scripts/safe-sync-launchd.sh scripts/install-macos-safe-sync-agent.sh
./scripts/install-macos-safe-sync-agent.sh
```

## 4. Daily

- Work on feature branches from updated `main`
- End of session: commit + `./scripts/safe-push.sh`
- Other Mac / VPS: GitHub `main` + Actions deploy

## 5. Optional leftovers (local only — never commit)

```text
galaxus/GDELR_*.xml
*.csv
retention-summary.md
tmp/
scripts/export-retention-files.ts   # optional archive later
scripts/shopify-retention-analysis.ts
```
