#!/usr/bin/env bash
# Local recette server for the warehouse module: Next dev on the ISOLATED test database only.
# Never reads a production .env. Usage: scripts/warehouse/dev-server.sh [port]
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${1:-3111}"
DB_URL="$(scripts/warehouse/dev-db.sh url)"
case "$DB_URL" in *@127.0.0.1:*|*@localhost:*) ;; *) echo "Refus: base non locale" >&2; exit 1;; esac
export DATABASE_URL="$DB_URL" DIRECT_URL="$DB_URL"
export JWT_SECRET="local-warehouse-recette-secret" ADMIN_PASSWORD="admin-local" LOGISTICS_PASSWORD="logistics-local"
export WAREHOUSE_MODULE_ENABLED="true" WAREHOUSE_WRITES_ENABLED="${WAREHOUSE_WRITES_ENABLED:-true}"
export WAREHOUSE_LABEL_JOURNAL_DIR="${WAREHOUSE_LABEL_JOURNAL_DIR:-$HOME/.cache/resell-warehouse-journal}"
export NEXT_TELEMETRY_DISABLED=1
exec npx next dev -p "$PORT"
