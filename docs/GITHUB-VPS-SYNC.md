# GitHub ↔ Macs ↔ VPS sync

GitHub `main` is the only source of truth. No VPS hotfixes. No silent overwrite of dirty laptop work.

## One-time: `gh` CLI

Already on Mac principal: `~/.local/bin/gh` (add to PATH).

```bash
export PATH="$HOME/.local/bin:$PATH"
# Interactive (required once — git HTTPS token may not work for API):
gh auth login
gh auth status
```

Second Mac: same, or `brew install gh` then `gh auth login`.

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

On every push to `main`, Actions SSHs to `/opt/resell` and runs `scripts/vps-deploy-from-github.sh` for that SHA.

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
