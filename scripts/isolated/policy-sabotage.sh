#!/bin/bash
# The final policy's sabotage: break each consequential boundary on purpose, and the suite that guards it must go RED.
#
#   scripts/isolated/policy-sabotage.sh [template-db]     # default: cand
#
# For every case: (1) apply the break to a fresh copy of the database or to a COPY of the source file, (2) print a line
# that PROVES it landed (a sabotage that did not apply is not a passing control), (3) run the suite and require a
# failure, (4) restore, (5) run it again and require green. Source files are restored from a backup taken first, and
# restored again by the trap if the script dies. Nothing here touches production.
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
TPL=${1:-cand}  # GROUP=1..7 runs one group
P="psql -h ${ISOLATED_PG_SOCKET:-/tmp/pgs} -p ${ISOLATED_PG_PORT:-55432} -U postgres -q"
declare -a TOUCHED=()
restore() { for f in "${TOUCHED[@]:-}"; do [ -n "$f" ] && [ -f "/tmp/sab-bak/$(echo "$f" | tr / _)" ] && cp "/tmp/sab-bak/$(echo "$f" | tr / _)" "$f"; done; }
trap restore EXIT
mkdir -p /tmp/sab-bak
status=0
RESULTS=()

suite() { # suite name, db
  npx tsx "scripts/isolated/policy-$1.ts" "$2" > "/tmp/sab-$1-$2.txt" 2>&1; local rc=$?
  echo "$rc"
}
fresh() { $P -c "drop database if exists $1" >/dev/null 2>&1; $P -c "create database $1 template $TPL"; }

sab_sql() { # name suite sql proofquery
  [ -z "${GROUP:-}" ] || [ "$GROUP" = "$G" ] || return 0
  local name=$1 suite=$2 sql=$3 proof=$4 db="sab_${1//-/_}"
  fresh "$db"
  $P -d "$db" -v ON_ERROR_STOP=1 -c "$sql" >/dev/null || { echo "SABOTAGE DID NOT APPLY: $name"; status=1; return; }
  local landed; landed=$($P -d "$db" -At -c "$proof")
  echo "   landed: $landed"
  local rc; rc=$(suite "$suite" "$db")
  local red="no"; [ "$rc" != "0" ] && red="YES"
  local failing; failing=$(grep -E "^FAIL" "/tmp/sab-$suite-$db.txt" | head -2 | cut -c1-110 | tr '\n' '|')
  fresh "ok_$db"; local rc2; rc2=$(suite "$suite" "ok_$db")
  local green="no"; [ "$rc2" = "0" ] && green="yes"
  echo "== $name: red=$red restored-green=$green  [$failing]"
  RESULTS+=("$name|$red|$green")
  [ "$red" = "YES" ] && [ "$green" = "yes" ] || status=1
}
sab_src() { # name suite file perl-expression proofgrep
  [ -z "${GROUP:-}" ] || [ "$GROUP" = "$G" ] || return 0
  local name=$1 suite=$2 file=$3 expr=$4 proof=$5 db="sab_${1//-/_}"
  cp "$file" "/tmp/sab-bak/$(echo "$file" | tr / _)"; TOUCHED+=("$file")
  perl -0pi -e "$expr" "$file"
  if cmp -s "$file" "/tmp/sab-bak/$(echo "$file" | tr / _)"; then echo "SABOTAGE DID NOT APPLY: $name"; status=1; return; fi
  echo "   landed: $(grep -c -E "$proof" "$file") line(s) match /$proof/ in $file"
  fresh "$db"
  local rc; rc=$(suite "$suite" "$db")
  local red="no"; [ "$rc" != "0" ] && red="YES"
  local failing; failing=$(grep -E "^FAIL" "/tmp/sab-$suite-$db.txt" | head -2 | cut -c1-110 | tr '\n' '|')
  cp "/tmp/sab-bak/$(echo "$file" | tr / _)" "$file"
  fresh "ok_$db"; local rc2; rc2=$(suite "$suite" "ok_$db")
  local green="no"; [ "$rc2" = "0" ] && green="yes"
  echo "== $name: red=$red restored-green=$green  [$failing]"
  RESULTS+=("$name|$red|$green")
  [ "$red" = "YES" ] && [ "$green" = "yes" ] || status=1
}

G=1; echo "### 1 Vikunja: delete under create/update authority"
sab_src vk-handler-delete-uses-write-tool vikunja src/handlers/tasks-sync.ts "s/tool: 'task\.board\.delete',\s*material: \{ provider: 'vikunja', board, externalId \}/tool: 'task.board.write', scope: board, material: { provider: 'vikunja', board, externalId }/" "tool: 'task\.board\.write', scope: board, material: \{ provider"
sab_sql vk-delete-is-a-level-two-tool vikunja "update public.tool_permissions set level = 2, scoped = true where tool = 'task.board.delete'" "select level||' scoped='||scoped from public.tool_permissions where tool = 'task.board.delete'"
sab_sql vk-standing-trigger-gone vikunja "drop trigger standing_never_covers_level_three on public.standing_authorizations; update public.tool_permissions set scoped = true where tool = 'task.board.delete'" "select count(*) from pg_trigger where tgname = 'standing_never_covers_level_three'"

G=2; echo "### 2 Slack provisioning: provenance"
sab_sql sc-anyone-is-a-person slack-channels "create or replace function app.person_provenance(p_by text, p_job uuid) returns text language sql as \$f\$ select 'grant'::text \$f\$" "select pg_get_functiondef('app.person_provenance(text,uuid)'::regprocedure) like '%select ''grant''%'"
sab_sql sc-authority-never-spent slack-channels "create or replace function app.consume_channel_authority(p_project uuid, p_job uuid) returns boolean language sql as \$f\$ select false \$f\$" "select pg_get_functiondef('app.consume_channel_authority(uuid,uuid)'::regprocedure) like '%select false%'"
sab_src sc-handler-ignores-the-gate slack-channels src/handlers/channels.ts "s/if \(!d\.ok\) \{\s*await quiet\(\)/if (false) {\n            await quiet()/" "if \(false\)"

G=3; echo "### 3 Notion destination"
sab_sql nt-scope-ignored notion "do \$m\$ declare d text; begin d := pg_get_functiondef('app.authorize_effect(uuid,uuid,text,uuid,text,text,text,uuid,text,text)'::regprocedure); execute replace(d, 'scope_ref = p_scope', 'scope_ref is not null'); end \$m\$" "select pg_get_functiondef('app.authorize_effect(uuid,uuid,text,uuid,text,text,text,uuid,text,text)'::regprocedure) like '%scope_ref is not null%'"
sab_sql nt-tool-wide-standing-allowed notion "update public.tool_permissions set scoped = false where tool = 'notion.write'" "select scoped from public.tool_permissions where tool = 'notion.write'"
sab_sql nt-system-mints-authority notion "create or replace function app.person_provenance(p_by text, p_job uuid) returns text language sql as \$f\$ select 'grant'::text \$f\$" "select pg_get_functiondef('app.person_provenance(text,uuid)'::regprocedure) like '%select ''grant''%'"

G=4; echo "### 4 Slack rotation"
sab_src sr-handler-rotates-without-approval slack-rotation src/handlers/slack-rotation.ts "s/if \(!decision\.ok\) \{/if (false) {/" "if \(false\)"
sab_sql sr-rotate-becomes-standing-capable slack-rotation "update public.tool_permissions set level = 2 where tool = 'slack.rotate'" "select level from public.tool_permissions where tool = 'slack.rotate'"

G=5; echo "### 5 Learning"
sab_src ln-authority-rules-stored learning src/agents/remember.ts "s/if \(reading\.bearsAuthority\) \{/if (false) {/" "if \(false\)"
sab_sql ln-authorization-reads-lessons learning "do \$m\$ declare d text; begin d := pg_get_functiondef('app.authorize_effect(uuid,uuid,text,uuid,text,text,text,uuid,text,text)'::regprocedure); execute replace(d, 'v := app.may_act_in(p_office, v_proj, p_tool, v_asked);', 'v := app.may_act_in(p_office, v_proj, p_tool, v_asked); if exists (select 1 from public.lessons_live where body ilike ''%authorised%'') then return v || jsonb_build_object(''verdict'', ''proceed''); end if;'); end \$m\$" "select pg_get_functiondef('app.authorize_effect(uuid,uuid,text,uuid,text,text,text,uuid,text,text)'::regprocedure) like '%lessons_live%'"
sab_src ln-anon-door-left-open learning migrations/0642_a_public_key_reaches_no_table_without_a_row_policy.sql "s/execute format\('revoke all on table %s from anon, authenticated', r\.t\);/execute format('select 1 \/* %s *\/', r.t);/" "select 1 /\\*"

G=6; echo "### 6 Retrieval"
sab_src rt-provenance-removed retrieval src/knowledge/retrieval.ts "s/scope: t\.account_level \? 'account' : 'other_project',\s*fromProject: \{ id: t\.project_id, name: t\.name \},//" "other_project"
sab_sql rt-siblings-include-fixtures retrieval "create or replace function app.sibling_projects(p_project uuid) returns table (project_id uuid, slug text, name text, account_level boolean) language sql stable as \$f\$ select p.project_id, p.slug, p.name, false from public.projects p where p.project_id is distinct from p_project \$f\$" "select pg_get_functiondef('app.sibling_projects(uuid)'::regprocedure) like '%false from public.projects%'"

G=7; echo "### 7 Proactivity"
sab_sql pr-outward-proceeds-at-suggest proactive "update public.autonomy_policy set verdict = 'proceed' where autonomy = 'suggest' and action_level = 2" "select verdict from public.autonomy_policy where autonomy = 'suggest' and action_level = 2"
sab_sql pr-outside-audience-floor-gone proactive "do \$m\$ declare d text; begin d := pg_get_functiondef('app.authorize_effect(uuid,uuid,text,uuid,text,text,text,uuid,text,text)'::regprocedure); execute replace(d, 'if p_audience = ''outside'' and v_verdict = ''proceed''', 'if false and p_audience = ''outside'' and v_verdict = ''proceed'''); end \$m\$" "select pg_get_functiondef('app.authorize_effect(uuid,uuid,text,uuid,text,text,text,uuid,text,text)'::regprocedure) like '%if false and p_audience%'"

echo
echo "SUMMARY"
for r in "${RESULTS[@]}"; do echo "  $r"; done
[ $status -eq 0 ] && echo "ALL SABOTAGES WENT RED AND RESTORED GREEN" || echo "A SABOTAGE STAYED GREEN OR DID NOT APPLY"
exit $status
