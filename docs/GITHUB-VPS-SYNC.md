# GitHub ↔ Macs ↔ VPS sync

GitHub `main` is the only source of truth. No VPS hotfixes. No silent overwrite of dirty laptop work.

## One-time per Mac (run in Terminal.app)

Cursor sandbox cannot write LaunchAgents — run this in **Terminal**:

```bash
cd /path/to/shopify-fulfillment-dashboard
chmod +x scripts/RUN-ONCE-MAC-SETUP.sh
./scripts/RUN-ONCE-MAC-SETUP.sh
gh auth login    # if prompted
```

Mac principal already has `~/.local/bin/gh`. Git HTTPS token ≠ GitHub API token → `gh auth login` once.

## Macs — safe sync

```bash
# Pull if tracked-clean; else print exact next step
./scripts/safe-sync.sh

# Push if tracked-clean and not behind
./scripts/safe-push.sh

# Install 10-min LaunchAgent (notify if dirty/diverged; pull if clean+behind)
./scripts/install-macos-safe-sync-agent.sh
# Logs: ~/Library/Logs/resell/safe-sync.log
```

Aliases (optional, `~/.zshrc`):

```bash
alias resell-sync='cd /path/to/shopify-fulfillment-dashboard && ./scripts/safe-sync.sh'
alias resell-push='cd /path/to/shopify-fulfillment-dashboard && ./scripts/safe-push.sh'
```

## GitHub Actions → VPS

Workflow: [`.github/workflows/deploy-vps.yml`](../.github/workflows/deploy-vps.yml)

Repo secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|--------|
| `SSH_HOST` | VPS IP / hostname |
| `SSH_USER` | usually `root` |
| `SSH_PRIVATE_KEY` | private key that can SSH (full PEM) |

Helper (after `gh auth login`):

```bash
chmod +x scripts/setup-github-deploy-secrets.sh
./scripts/setup-github-deploy-secrets.sh
gh workflow run "Deploy VPS"
```

On every push to `main`, Actions SSHs to `/opt/resell` and runs `scripts/vps-deploy-from-github.sh` for that SHA.

**VPS already aligned manually** to the merge SHA; add secrets so the next `main` push deploys automatically.

Manual deploy (laptop):

```bash
ssh resell-vps 'cd /opt/resell && EXPECTED_SHA=$(git rev-parse origin/main) bash -s' < scripts/vps-deploy-from-github.sh
# or after fetch on VPS:
ssh resell-vps 'cd /opt/resell && git fetch origin && EXPECTED_SHA=$(git rev-parse origin/main) bash scripts/vps-deploy-from-github.sh'
```

## Second Mac checklist

See [SECOND-MAC-SYNC-CHECKLIST.md](SECOND-MAC-SYNC-CHECKLIST.md).

## Forbidden

- Auto-commit every keystroke
- `git pull` over tracked dirty files
- `reset --hard` / `clean` / force-push to `main` without explicit ask
- Editing `/opt/resell` as a source of changes
