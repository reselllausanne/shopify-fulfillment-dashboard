#!/usr/bin/env bash
# Isolated local Postgres for the Warehouse module (integration, scale and restore tests).
#
# Never touches the production DB: it runs a throwaway PostgreSQL (same major/minor
# as production, 17.6) on localhost from binaries installed OUTSIDE the repo, so
# package.json / the Docker image stay unchanged.
#
#   scripts/warehouse/dev-db.sh start     # install binaries if needed, initdb, start, create DB
#   scripts/warehouse/dev-db.sh url       # print DATABASE_URL for the test DB
#   scripts/warehouse/dev-db.sh status
#   scripts/warehouse/dev-db.sh stop
#   scripts/warehouse/dev-db.sh reset     # drop + recreate the DB (keeps the cluster)
#   scripts/warehouse/dev-db.sh clone <port> <dir>   # physical copy of the cluster started on another port (restore drill)
#   scripts/warehouse/dev-db.sh destroy   # stop and delete the cluster
#
# Env: WAREHOUSE_PG_HOME (default ~/.cache/resell-warehouse-pg), WAREHOUSE_PG_PORT (54329),
#      WAREHOUSE_PG_DB (warehouse_test), WAREHOUSE_PG_VERSION (17.6.0-beta.15).
set -euo pipefail

PG_HOME="${WAREHOUSE_PG_HOME:-$HOME/.cache/resell-warehouse-pg}"
PG_PORT="${WAREHOUSE_PG_PORT:-54329}"
PG_DB="${WAREHOUSE_PG_DB:-warehouse_test}"
PG_VERSION="${WAREHOUSE_PG_VERSION:-17.6.0-beta.15}"
PG_USER="warehouse"
PG_PASSWORD="warehouse"
DATA_DIR="${WAREHOUSE_PG_DATA:-$PG_HOME/data}"
LOG_FILE="$PG_HOME/postgres.log"

platform_pkg() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="x64" ;;
  esac
  echo "${os}-${arch}"
}

BIN_DIR="$PG_HOME/node_modules/@embedded-postgres/$(platform_pkg)/native/bin"

ensure_binaries() {
  if [[ -x "$BIN_DIR/postgres" ]]; then return; fi
  mkdir -p "$PG_HOME"
  (
    cd "$PG_HOME"
    [[ -f package.json ]] || npm init -y >/dev/null 2>&1
    npm install "embedded-postgres@${PG_VERSION}" --no-audit --no-fund >/dev/null
  )
  if [[ ! -x "$BIN_DIR/postgres" ]]; then
    echo "Postgres binaries not found in $BIN_DIR" >&2
    exit 1
  fi
}

is_running() {
  "$BIN_DIR/pg_ctl" -D "$1" status >/dev/null 2>&1
}

db_url() {
  echo "postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${1:-$PG_PORT}/${PG_DB}?schema=public"
}

start_cluster() {
  local dir="$1" port="$2" log="$3"
  if is_running "$dir"; then return; fi
  "$BIN_DIR/pg_ctl" -D "$dir" -l "$log" -w -t 60 \
    -o "-p ${port} -c listen_addresses=127.0.0.1 -c timezone=UTC -c max_connections=200 -c shared_buffers=512MB -c work_mem=16MB -c maintenance_work_mem=512MB -c max_wal_size=4GB -c log_min_duration_statement=500 -c log_lock_waits=on" \
    start >/dev/null
}

# Minimal SQL runner without psql: node + pg from the repo's node_modules.
run_sql() {
  local database="$1" sql="$2" port="${3:-$PG_PORT}"
  PGSQL="$sql" node -e '
    const { Client } = require("pg");
    (async () => {
      const c = new Client({ host: "127.0.0.1", port: Number(process.argv[1]), user: process.argv[2], password: process.argv[3], database: process.argv[4] });
      await c.connect();
      const r = await c.query(process.env.PGSQL);
      if (r.rows && r.rows.length) console.log(JSON.stringify(r.rows));
      await c.end();
    })().catch((e) => { console.error(e.message); process.exit(1); });
  ' "$port" "$PG_USER" "$PG_PASSWORD" "$database"
}

cmd="${1:-status}"
case "$cmd" in
  start)
    ensure_binaries
    if [[ ! -f "$DATA_DIR/PG_VERSION" ]]; then
      mkdir -p "$DATA_DIR"
      pwfile="$(mktemp)"
      echo "$PG_PASSWORD" > "$pwfile"
      "$BIN_DIR/initdb" -D "$DATA_DIR" -U "$PG_USER" --pwfile="$pwfile" --auth=scram-sha-256 -E UTF8 --locale=C >/dev/null
      rm -f "$pwfile"
    fi
    start_cluster "$DATA_DIR" "$PG_PORT" "$LOG_FILE"
    exists="$(run_sql postgres "select 1 as ok from pg_database where datname='${PG_DB}'" || true)"
    if [[ -z "$exists" ]]; then
      run_sql postgres "create database \"${PG_DB}\""
    fi
    echo "started: $(db_url)"
    ;;
  url)
    db_url
    ;;
  status)
    ensure_binaries
    if is_running "$DATA_DIR"; then echo "running: $(db_url)"; else echo "stopped"; fi
    ;;
  stop)
    ensure_binaries
    if is_running "$DATA_DIR"; then "$BIN_DIR/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null; fi
    echo "stopped"
    ;;
  reset)
    ensure_binaries
    start_cluster "$DATA_DIR" "$PG_PORT" "$LOG_FILE"
    run_sql postgres "drop database if exists \"${PG_DB}\" with (force)"
    run_sql postgres "create database \"${PG_DB}\""
    echo "reset: $(db_url)"
    ;;
  clone)
    # Physical copy = restore drill on an isolated cluster. Source is checkpointed and
    # stopped during the copy so the copy is a consistent base backup.
    ensure_binaries
    clone_port="${2:?clone port required}"
    clone_dir="${3:?clone dir required}"
    if [[ -e "$clone_dir" ]]; then echo "clone dir already exists: $clone_dir" >&2; exit 1; fi
    was_running=0
    if is_running "$DATA_DIR"; then was_running=1; "$BIN_DIR/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null; fi
    cp -R "$DATA_DIR" "$clone_dir"
    rm -f "$clone_dir/postmaster.pid"
    if [[ "$was_running" == "1" ]]; then start_cluster "$DATA_DIR" "$PG_PORT" "$LOG_FILE"; fi
    start_cluster "$clone_dir" "$clone_port" "$clone_dir/clone.log"
    echo "clone started: $(db_url "$clone_port")"
    ;;
  stop-clone)
    ensure_binaries
    clone_dir="${2:?clone dir required}"
    if is_running "$clone_dir"; then "$BIN_DIR/pg_ctl" -D "$clone_dir" -m fast -w stop >/dev/null; fi
    echo "clone stopped"
    ;;
  destroy)
    ensure_binaries
    if is_running "$DATA_DIR"; then "$BIN_DIR/pg_ctl" -D "$DATA_DIR" -m fast -w stop >/dev/null; fi
    rm -rf "$DATA_DIR"
    echo "destroyed"
    ;;
  *)
    echo "usage: $0 start|url|status|stop|reset|clone <port> <dir>|stop-clone <dir>|destroy" >&2
    exit 2
    ;;
esac
