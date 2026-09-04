#!/usr/bin/env bash
# Sobe um Postgres 16 efêmero, cria um stub do schema auth do Supabase, aplica as migrations
# e executa os testes SQL de RLS/constraints em tests/sql/*.sql. Não substitui o Supabase real:
# valida schema, políticas e triggers sem Realtime/Auth/Edge Functions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DATA="$ROOT/.pgdata"
PORT="${PGPORT_TEST:-54329}"
export PGPASSWORD=postgres

cleanup() { "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT

rm -rf "$DATA"
RUNAS=""
if [ "$(id -u)" = "0" ]; then RUNAS="runuser -u postgres --"; chown -R postgres "$ROOT" 2>/dev/null || true; fi
$RUNAS "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
$RUNAS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1 -c wal_level=logical" -w start >/dev/null
DB="postgres://postgres@127.0.0.1:$PORT/postgres"

psql "$DB" -v ON_ERROR_STOP=1 -q -f "$ROOT/tests/sql/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
for f in "$ROOT"/tests/sql/[1-9]*.sql; do
  echo "→ test $(basename "$f")"
  psql "$DB" -v ON_ERROR_STOP=1 -q -o /dev/null -f "$f"
done
echo "✔ migrations e testes SQL passaram"
