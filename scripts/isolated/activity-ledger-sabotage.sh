#!/bin/bash
# Sabotage the activity ledger on purpose and watch the proofs go red (migrations 1060 and 1061).
#
#   bash scripts/isolated/activity-ledger-sabotage.sh            # every sabotage
#   bash scripts/isolated/activity-ledger-sabotage.sh S2 S5      # some
#
# CLAUDE.md: "a sabotage that did not apply is not a passing control". Each one is a text replacement in a COPY of the migration or
# the gateway; the script first checks that the replacement landed (the old text is present and the new file differs), then applies
# the copy to a fresh clone of the replica, runs the named proof, and requires BOTH that the run is red AND that the check named
# in the table is among the failures. A run that is red for some other reason is reported as such and counts as a miss.
# Nothing in the repository is changed: the working copies live in a temporary directory and the clones are dropped.
#
# Needs the replica from scripts/isolated/replica.sh. Each sabotage takes about a minute.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
SOCK=${ISOLATED_PG_SOCKET:-/tmp/pgs}; PORT=${ISOLATED_PG_PORT:-55432}
P="psql -h $SOCK -p $PORT -U postgres -X -q"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; $P -d postgres -c "drop database if exists ledger_sab" >/dev/null 2>&1' EXIT

M60=$(ls "$ROOT"/migrations/1060_*.sql); M61=$(ls "$ROOT"/migrations/1061_*.sql)
GW=supabase/functions/hq-api/index.ts

# id | target (60, 61 or gw) | old text | new text | proof | the check that must fail (a substring of its name)
SABOTAGES=(
  "S1|61|join public.jobs j on j.job_id = t.job_id and j.office_id = \$1~~where j0.job_id = t0.job_id and j0.office_id = \$1|join public.jobs j on j.job_id = t.job_id~~where j0.job_id = t0.job_id|activity-ledger|isolation"
  "S2|60|create trigger activity_events_reject_update before update on public.activity_events\n  for each row execute function app.reject_ledger_mutation();|create trigger activity_events_reject_update before update on public.activity_events\n  for each row when (false) execute function app.reject_ledger_mutation();|activity-ledger|append-only"
  "S3|60|  if p_text is null or p_text = '' then return p_text; end if;|  return p_text;|activity-ledger|redaction: no credential family"
  "S4|60|  on conflict (office_id, idempotency_key) do nothing\n  returning activity_id into v_id;|  returning activity_id into v_id;|activity-ledger|the same key twice"
  "S5|60|select coalesce((select c.value = 'true'::jsonb from public.system_config c where c.key = 'activity.ledger_enabled'), false)|select coalesce((select c.value = 'true'::jsonb from public.system_config c where c.key = 'activity.ledger_enabled'), true)|activity-ledger|fails closed"
  "S5b|60|values ('activity.ledger_enabled', 'false'::jsonb,|values ('activity.ledger_enabled', 'true'::jsonb,|activity-ledger|off by default"
  "S6|60|select * into v_type from public.activity_event_types where event_type = p_event_type and external_writable;|select * into v_type from public.activity_event_types where event_type = p_event_type;|activity-ledger|it cannot forge"
  "S7|61|c.callback_action is null and not c.synthetic~~c0.callback_action is null and not c0.synthetic|c.callback_action is null~~c0.callback_action is null|activity-ledger|a suite's message is not shown"
  "S8|60|create trigger activity_events_visibility before insert on public.activity_events\n  for each row execute function|create trigger activity_events_visibility before insert on public.activity_events\n  for each row when (false) execute function|activity-ledger|diagnostic type cannot be written as ordinary"
  "S9|61|and not exists (select 1 from lastat l where (stats.minat, stats.minid) <= (l.at, l.id))) '|and false) '|activity-ledger|deeper than"
  "S10|60|  exception when others then|  exception when no_data_found then|activity-ledger|the safe writer never raises"
  "S11|61|    and ((q.vis_override is null and app.activity_type_visrank(q.type) <= \$10) or q.vis_override <= \$10)|    and (true)|activity-ledger|native diagnostic events"
  "S12|61|where \$10 >= 1 and u.office_id = \$1~~where \$10 >= 1 and u0.office_id = \$1|where \$10 >= 1~~where \$10 >= 1|activity-ledger|neither feed"
  "S16|61|where hj.hjob is null or not hj.h|where true|activity-ledger|only the canonical predicate"
  "S26|60|t := left(normalize(t, NFKC), 4000);|t := left(t, 4000);|activity-redaction|key and value in full-width letters"
  "S27|60|\\x200B-\\x200F\\x202A|\\x200C-\\x200F\\x202A|activity-redaction|slack token split by a zero-width space"
  "S28|60|'([a-z][a-z0-9+.-]{1,20}://)(?:|'([a-z][a-z0-9+.-]{1,20}://ZZ)(?:|activity-redaction|url user and password"
  "S29|60|pass(?:word|passZZ(?:word|activity-redaction|password assignment"
  "S30|60|(r.run ~ '[a-z]' and r.run ~ '[A-Z]')|false|activity-redaction|mixed-case run a vendor never listed"
  "S31|60|perform pg_advisory_xact_lock(hashtextextended(|perform pg_try_advisory_xact_lock(hashtextextended(|activity-external-attack|quota: 480 concurrent"
  "S32|60|length(p_idempotency_key) not between 1 and 150|length(p_idempotency_key) not between 0 and 150|activity-external-attack|identity: an empty, over-long"
  "S33|61|case when rs.slug is null then 'system' else 'agent' end, coalesce(rs.slug, 'office')|'agent', coalesce(rs.slug, 'office')|activity-ledger|review provenance: an output marked approved"
  "S13|gw|if (!/^\\d{1,3}\$/.test(text))|if (false)|activity-gateway|refused by name"
  "S14|gw|    requireOne: ['job', 'correlation'],||activity-gateway|a chain with neither"
  "S17|60|    if exists (select 1 from public.activity_event_types t where t.event_type = p_event_type and t.durability = 'critical') then|    if false then|activity-ledger-durability|the best-effort writer refuses a critical type"
  "S18|61|and (b.on_answer is not null or b.standing_option is not null) then 'approval.granted'|then 'approval.granted'|activity-ledger-review|is NOT recorded as a yes"
  "S19|60|    if p_correlation_id is not null and p_correlation_id is distinct from v_corr then|    if false then|activity-ledger-review|a correlation that is not the job"
  "S20|61|[\"job.failed\", \"t0.to_state = 'failed'\"]|[\"job.failed\", \"t0.to_state = 'cancelled'\"]|activity-ledger-equivalence|every filter returns exactly"
  "S21|61|and (\$4::uuid is null or q.job_id in (select js.job_id from jset js))|and (\$4::uuid is null or q.job_id = \$4)|activity-ledger-review|includes its grandchildren"
  "S22|61|d.message_ref is not null and d.message_ref not like 'confirmed-by-person:%'|d.message_ref is not null|activity-ledger-review|marked as arrived is not provider-confirmed"
  "S23|60|  t := left(p_text, 4000);|  t := p_text;|activity-ledger-review|redacting an 80 000 character"
  "S24|60|a.occurred_at > app.now_utc() - interval '1 hour') >= 300 then|a.occurred_at > app.now_utc() - interval '1 hour') >= 300000000 then|activity-ledger-review|limited per hour"
  "S25|61|and not exists (select 1 from public.projects fp where fp.project_id = b.project_id and fp.is_fixture)||activity-ledger-review|fixture project, with no job"
  "S15|gw|args = { ...args, [extra.arg]: text }|args = { ...args, [extra.arg]: new Date(Date.parse(text)).toISOString() }|activity-gateway|microseconds apart"
)

want=("$@")
selected() { [ ${#want[@]} -eq 0 ] && return 0; for w in "${want[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }

# The replica's `post` may ALREADY carry migrations 1060 and 1061 (replica.sh replays every file), and re-applying a sabotaged copy over
# them would change only the functions: a seed row, a table or a trigger would keep its real definition and the sabotage would not land.
# So every clone starts from `post` with the ledger's objects removed, and the migrations are applied fresh, as they would be on production.
strip_ledger() {
  $P -d ledger_sab -c "
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
  left=$($P -d ledger_sab -At -c "select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app','public') and p.proname in ('activity_read','record_activity'))
                                   + (select count(*) from pg_class where relname in ('activity_events','activity_event_types'))
                                   + (select count(*) from public.system_config where key = 'activity.ledger_enabled')")
  [ "$left" = "0" ] || { echo "  (the clone still holds $left ledger object(s); the sabotage would not be honest)"; return 1; }
}
clone() {
  $P -d postgres -c "drop database if exists ledger_sab" -c "create database ledger_sab template post" >/dev/null 2>&1
  strip_ledger
}
apply() { for f in "$@"; do $P -d ledger_sab -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "  (migration did not apply: $f)"; return 1; }; done; }
mutate() { # file old new out  -> exit 0 only if the old text was present and the output differs
  python3 -I - "$1" "$2" "$3" "$4" <<'PY'
import sys
src, old, new, out = sys.argv[1:5]
s = open(src).read()
# several replacements in one sabotage: old1~~old2 and new1~~new2, applied in order, each of which must land
olds = [x.replace("\\n", "\n") for x in old.split("~~")]
news = [x.replace("\\n", "\n") for x in new.split("~~")]
if len(olds) != len(news):
    print("  SABOTAGE TABLE ERROR: unequal number of old and new texts"); sys.exit(2)
t = s
for o, n in zip(olds, news):
    if o not in t:
        print("  SABOTAGE DID NOT APPLY: the old text is not in the file: " + o[:60]); sys.exit(2)
    t = t.replace(o, n, 1)
if t == s:
    print("  SABOTAGE DID NOT APPLY: the file is unchanged"); sys.exit(2)
open(out, "w").write(t)
PY
}

hit=0; missed=0; total=0
for row in "${SABOTAGES[@]}"; do
  IFS='|' read -r id target old new proof check <<<"$row"
  selected "$id" || continue
  total=$((total+1))
  echo "== $id: $proof must fail '$check' (sabotage in $target)"
  clone
  # Multi-line anchors are carried in the table with a literal newline; the read above splits on '|' only.
  m60="$M60"; m61="$M61"; gwfile="$ROOT/$GW"; work=""
  case "$target" in
    60) mutate "$M60" "$old" "$new" "$TMP/m60.sql" || { missed=$((missed+1)); echo "  MISS (did not apply)"; continue; }; m60="$TMP/m60.sql" ;;
    61) mutate "$M61" "$old" "$new" "$TMP/m61.sql" || { missed=$((missed+1)); echo "  MISS (did not apply)"; continue; }; m61="$TMP/m61.sql" ;;
    gw) work="$TMP/wt"; rm -rf "$work"; git -C "$ROOT" worktree add -q --detach "$work" HEAD >/dev/null 2>&1 || { echo "  no worktree"; continue; }
        cp "$ROOT/$GW" "$work/$GW"; ln -s "$ROOT/node_modules" "$work/node_modules" 2>/dev/null
        mutate "$work/$GW" "$old" "$new" "$work/$GW.new" || { missed=$((missed+1)); echo "  MISS (did not apply)"; git -C "$ROOT" worktree remove --force "$work" >/dev/null 2>&1; continue; }
        mv "$work/$GW.new" "$work/$GW" ;;
  esac
  apply "$m60" "$m61" || { missed=$((missed+1)); continue; }
  base="$ROOT"; [ -n "$work" ] && base="$work"
  out=$(cd "$base" && timeout 280 npx tsx "scripts/isolated/$proof.ts" ledger_sab 2>&1); code=$?
  [ -n "$work" ] && git -C "$ROOT" worktree remove --force "$work" >/dev/null 2>&1
  if [ $code -ne 0 ] && grep -F "FAIL" <<<"$out" | grep -qF "$check"; then
    hit=$((hit+1)); echo "  caught: $(grep -F FAIL <<<"$out" | grep -F "$check" | head -1 | cut -c1-120)"
  elif [ $code -ne 0 ]; then
    missed=$((missed+1)); echo "  MISS: red, but not at '$check'. First failure: $(grep -F FAIL <<<"$out" | head -1 | cut -c1-120)"
  else
    missed=$((missed+1)); echo "  MISS: the proof stayed GREEN with the protection removed"
  fi
done

# The control: the unmodified migrations pass the same proofs, so a red above was the sabotage and not the harness.
echo "== control: nothing sabotaged"
clone; apply "$M60" "$M61" && {
  c1=$(cd "$ROOT" && timeout 280 npx tsx scripts/isolated/activity-ledger.ts ledger_sab 2>&1 | tail -1)
  clone; apply "$M60" "$M61"
  c2=$(cd "$ROOT" && timeout 280 npx tsx scripts/isolated/activity-gateway.ts ledger_sab 2>&1 | tail -1)
  echo "  activity-ledger: $c1"; echo "  activity-gateway: $c2"
}
echo "sabotages caught: $hit of $total (missed $missed)"
[ "$missed" -eq 0 ]
