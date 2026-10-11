#!/bin/bash
# Rehearse the ledger's deployment failure modes on the isolated replica (docs/activity-ledger/MIGRATION-PLAN.md, rehearsal).
#   bash scripts/isolated/activity-migration-rehearsal.sh
# Builds a clone of the replica with the ledger objects stripped and ONLY 1060 applied, then runs the TypeScript rehearsal against it.
# Local only: it refuses nothing it needs, contacts no production and sets no production flag. Drops its database afterwards.
set -uo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"
SOCK=${ISOLATED_PG_SOCKET:-/tmp/pgs}; PORT=${ISOLATED_PG_PORT:-55432}
P="psql -h $SOCK -p $PORT -U postgres -X -q"
DB=ledger_rh
trap '$P -d postgres -c "drop database if exists $DB" >/dev/null 2>&1' EXIT
$P -d postgres -c "drop database if exists $DB" -c "create database $DB template post" >/dev/null 2>&1
$P -d $DB -c "
  do \$\$ declare r record; begin
    for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('app', 'public')
                and ((p.proname like 'activity\_%' and p.proname <> 'activity_category')
                     or p.proname in ('record_activity', 'record_activity_safely', 'record_external_activity'))
    loop execute 'drop function ' || r.sig || ' cascade'; end loop;
  end \$\$;
  drop table if exists public.activity_write_failures cascade;
  drop table if exists public.activity_events cascade;
  drop table if exists public.activity_event_types cascade;
  delete from public.system_config where key = 'activity.ledger_enabled';" >/dev/null 2>&1
for f in migrations/1060_*.sql; do $P -d $DB -v ON_ERROR_STOP=1 -f $f 2>&1 | grep -v NOTICE; done
timeout 300 npx tsx scripts/isolated/activity-migration-rehearsal.ts $DB 2>&1 | tee /tmp/claude-0/rehearsal.out | grep -E "^ok|^FAIL|passed|Error" | cut -c1-300
grep -q "passed" /tmp/claude-0/rehearsal.out && ! grep -q "^FAIL" /tmp/claude-0/rehearsal.out
