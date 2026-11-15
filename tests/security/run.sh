#!/usr/bin/env bash
# Isolated PostgreSQL only; never connects to an existing database.
set -euo pipefail
export LC_ALL=C
cd "$(dirname "$0")/../.."
PGBIN=${PGBIN:-$(pg_config --bindir)}
for tool in initdb pg_ctl psql; do test -x "$PGBIN/$tool" || { echo "Missing $PGBIN/$tool; set PGBIN" >&2; exit 1; }; done
tmp=$(mktemp -d "/tmp/arcsec.XXXXXX")
cleanup() { "$PGBIN/pg_ctl" -D "$tmp/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT
"$PGBIN/initdb" -D "$tmp/data" -A trust --no-locale >/dev/null
# Unix socket in private directory; no TCP listener.
"$PGBIN/pg_ctl" -D "$tmp/data" -o "-k $tmp -c listen_addresses=''" -l "$tmp/log" start >/dev/null || { cat "$tmp/log" >&2; exit 1; }
psql=("$PGBIN/psql" -X -v ON_ERROR_STOP=1 -h "$tmp" -d postgres)
"${psql[@]}" -f tests/security/supabase-stub.sql
for migration in supabase/migrations/*.sql; do "${psql[@]}" -f "$migration"; done
"${psql[@]}" -f tests/security/security.sql -f tests/security/assets.sql
