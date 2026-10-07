#!/bin/bash
# An isolated replica of the production schema, built from this repository's
# migrations alone (behavioural remediation completion pass, ledger R48).
#
#   sudo scripts/isolated/replica.sh            # builds databases base / pre / post
#
# base : every migration before 0592, replayed from 0001
# pre  : base + 0592..0598   (0599 ABSENT - the recovery sweep still raises)
# post : pre  + 0599 + every later migration (the candidate)
#
# Why a replica: the first remediation session proved failure paths against the
# canonical database and stopped the production worker for 87 minutes. The
# proofs in this folder break things on purpose and refuse to run anywhere but
# a marked local socket (guard.ts).
#
# Fidelity, measured on 25 Sep 2026 against production read-only: 2589 tables,
# columns, function signatures, triggers and indexes identical, 806 function
# bodies identical by md5. The history is replayed with ON_ERROR_ROLLBACK so a
# migration's closing DATA assertion (which needs production's rows) fails
# alone and its DDL survives; 28 files have such assertions and none is DDL.
# No production data and no secret value is copied: vault names only, from a
# file you supply as SECRET_NAMES (one per line), each with a placeholder.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DATA=${ISOLATED_PG_DATA:-/var/tmp/pgl/data}; SOCK=${ISOLATED_PG_SOCKET:-/tmp/pgs}; PORT=${ISOLATED_PG_PORT:-55432}
EXT=$($PGBIN/pg_config --sharedir)/extension
cp "$ROOT"/scripts/isolated/extensions/* "$EXT"/
mkdir -p "$(dirname "$DATA")" "$SOCK"; chown postgres "$(dirname "$DATA")" "$SOCK"
if [ ! -d "$DATA" ]; then su postgres -s /bin/bash -c "$PGBIN/initdb -D $DATA -U postgres --auth=trust >/dev/null"; fi
su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $DATA -o \"-p $PORT -k $SOCK -c listen_addresses=''\" -l $DATA/../log start" >/dev/null 2>&1 || true
sleep 2
P="psql -h $SOCK -p $PORT -U postgres -q"
$P -c "drop database if exists base" ; $P -c "create database base"
$P -c "alter database base set search_path to \"\$user\", public, extensions"
$P -d base -v ON_ERROR_STOP=1 -f "$ROOT/scripts/isolated/platform.sql"
if [ -n "${SECRET_NAMES:-}" ]; then
  while read -r n; do [ -n "$n" ] && $P -d base -c "insert into vault.secrets(name, secret) values ('${n//\'/\'\'}', 'local-placeholder') on conflict (name) do nothing"; done < "$SECRET_NAMES"
fi
errors=0
for f in $(cd "$ROOT/migrations" && ls [0-9][0-9][0-9][0-9]_*.sql | sort); do
  n=${f%%_*}; [ "$n" \< "0592" ] || break
  # Captured, THEN searched. `psql … | grep -q ERROR` exits at the first match
  # and psql dies of SIGPIPE mid-file, so every statement after a file's first
  # error was never run: the replica silently lacked 33 app/public functions
  # (public.enqueue_inbound among them) while this line reported success.
  out=$($P -d base -v ON_ERROR_STOP=0 -v ON_ERROR_ROLLBACK=on -f "$ROOT/migrations/$f" 2>&1 || true)
  if grep -q ERROR <<<"$out"; then errors=$((errors+1)); fi
done
echo "history replayed; $errors file(s) with data assertions that need production rows"
$P -d base -c "create table public.isolated_replica_marker (built_at timestamptz default now())"
$P -c "drop database if exists pre"; $P -c "create database pre template base"
for f in $(cd "$ROOT/migrations" && ls 059[2-8]_*.sql); do $P -d pre -v ON_ERROR_STOP=1 -1 -f "$ROOT/migrations/$f" >/dev/null; echo "pre: $f"; done
$P -c "drop database if exists post"; $P -c "create database post template pre"
$P -d post -v ON_ERROR_STOP=1 -1 -f "$ROOT/migrations/0599_one_stalled_job_must_not_stop_the_office.sql" >/dev/null && echo "post: 0599"
# post is the candidate: every migration after 0599 too (0600 onwards), each
# in its own transaction and stopping at the first error, as `npm run migrate`
# would apply them.
for f in $(cd "$ROOT/migrations" && ls [0-9][0-9][0-9][0-9]_*.sql | sort); do
  n=${f%%_*}; [ "$n" \> "0599" ] || continue
  $P -d post -v ON_ERROR_STOP=1 -1 -f "$ROOT/migrations/$f" >/dev/null; echo "post: $f"
done
# Which migration files `post` holds, recorded in `post` itself. The gate (scripts/gate/run.ts) builds its candidate as `post`
# plus every migration file NOT in this list, so a rebuilt replica never has a migration applied to it twice. (A `post` built
# before this table existed is taken to hold every migration up to 1026.)
$P -d post -c "create table public.isolated_replica_migrations (name text primary key)"
for f in $(cd "$ROOT/migrations" && ls [0-9][0-9][0-9][0-9]_*.sql | sort); do
  $P -d post -c "insert into public.isolated_replica_migrations(name) values ('$f')"
done
