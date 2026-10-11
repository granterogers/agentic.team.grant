#!/bin/bash
# The Activity screen with genuine ledger rows (phase 4 P0). Builds a disposable database (the replica with the ledger stripped and
# 1060 to 1062 applied fresh, the switch on) and runs activity-ui-browser.ts against it. Local only; nothing from production.
#   bash scripts/isolated/activity-ui-browser.sh [--shots=<dir>] [--only=1440,390,320]
set -uo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"
P="psql -h ${ISOLATED_PG_SOCKET:-/tmp/pgs} -p ${ISOLATED_PG_PORT:-55432} -U postgres -X -q"
DB=ui_led
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
for f in migrations/1060_*.sql migrations/1061_*.sql migrations/1062_*.sql; do $P -d $DB -v ON_ERROR_STOP=1 -f $f 2>&1 | grep -v NOTICE; done
timeout 500 npx tsx scripts/isolated/activity-ui-browser.ts $DB "$@"
