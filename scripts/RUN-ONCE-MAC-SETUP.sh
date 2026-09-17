#!/usr/bin/env bash
# Run ONCE in Terminal.app (not inside Cursor sandbox) on each Mac.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== repo $ROOT"
chmod +x scripts/safe-sync.sh scripts/safe-push.sh scripts/safe-sync-launchd.sh scripts/install-macos-safe-sync-agent.sh

# PATH + aliases
touch "$HOME/.zshrc"
grep -q '.local/bin' "$HOME/.zshrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.zshrc"
if ! grep -q 'resell-sync' "$HOME/.zshrc"; then
  cat >> "$HOME/.zshrc" <<EOF

alias resell-sync='cd "$ROOT" && ./scripts/safe-sync.sh'
alias resell-push='cd "$ROOT" && ./scripts/safe-push.sh'
EOF
fi

# gh
export PATH="$HOME/.local/bin:$PATH"
if ! command -v gh >/dev/null 2>&1; then
  echo "Install gh: brew install gh   OR copy binary to ~/.local/bin/gh"
else
  echo "gh: $(command -v gh) ($(gh --version | head -1))"
  if ! gh auth status >/dev/null 2>&1; then
    echo "Run: gh auth login"
  fi
fi

bash scripts/install-macos-safe-sync-agent.sh
echo
echo "OK. New shell: source ~/.zshrc"
echo "Test: resell-sync"
echo "Logs: ~/Library/Logs/resell/safe-sync.log"
