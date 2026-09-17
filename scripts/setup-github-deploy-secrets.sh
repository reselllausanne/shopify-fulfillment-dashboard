#!/usr/bin/env bash
# Set GitHub Actions deploy secrets from local SSH config (run in Terminal with gh auth).
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"

if ! gh auth status >/dev/null 2>&1; then
  echo "gh not authenticated. Run: gh auth login"
  exit 1
fi

HOST="$(ssh -G resell-vps 2>/dev/null | awk '/^hostname /{print $2; exit}')"
USER="$(ssh -G resell-vps 2>/dev/null | awk '/^user /{print $2; exit}')"
KEY="$(ssh -G resell-vps 2>/dev/null | awk '/^identityfile /{print $2; exit}')"
KEY="${KEY/#\~/$HOME}"

if [ -z "$HOST" ] || [ -z "$USER" ] || [ ! -f "$KEY" ]; then
  echo "Could not resolve resell-vps from ~/.ssh/config"
  echo "Set manually:"
  echo "  gh secret set SSH_HOST"
  echo "  gh secret set SSH_USER"
  echo "  gh secret set SSH_PRIVATE_KEY < key.pem"
  exit 1
fi

echo "Setting secrets for host=$HOST user=$USER key=$KEY"
printf '%s' "$HOST" | gh secret set SSH_HOST
printf '%s' "$USER" | gh secret set SSH_USER
gh secret set SSH_PRIVATE_KEY < "$KEY"
echo "Done. Re-run workflow: gh workflow run deploy-vps.yml"
