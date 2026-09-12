-- 0301 — an agent can say what its connectors do
--
-- Issue #51's last box: *"Each agent can state what its connectors can do for
-- it."*
--
-- 0300 made the sheet. This puts the half an agent needs into the index its
-- prompt is built from.
--
-- ## Only the gap, and deliberately not the whole sheet
--
-- There are twenty-five verbs across six connectors. Putting all of them in
-- front of the model on every job would add roughly two thousand characters to
-- a prompt that is already three and a half thousand — on the free tier, for a
-- list that barely changes. That is the cost of the feature exceeding the
-- feature.
--
-- What an agent cannot work out for itself, and what nothing else tells it, is
-- the GAP: *this connector can do something reachable that the office never
-- does*. `reach` already tells it which services it can touch and
-- `tool_permissions.verbs` already tells it what each tool does; neither can
-- say "and here is something you have never been asked for".
--
-- So `could` is that list, and it is short by construction — a capability moves
-- out of it the moment anything uses it. Today it holds exactly one row.
--
-- This is also #52's input. A suggestion drawn from `unused_capabilities` is a
-- fact about the office; one drawn from a model asked "what could we do better"
-- is an opinion, and the difference is why #52 exists.
--
-- Patched from `pg_get_functiondef`, with one key added.

begin;

/*
  The original, renamed rather than restated.

  `capability_index` is a hundred lines of CTEs, and every restatement of it is
  a chance to drop one — which is exactly how 0164 lost an `order by` from a
  nine-line function and broke un-scoping for a fortnight. A wrapper adds a
  top-level key and cannot mislay anything.

  Callers are unaffected: `public.hq_capability_index` and `capabilityNow` both
  ask for `app.capability_index`, which still exists and now answers with one
  more key.
*/
alter function app.capability_index(text) rename to capability_index_core;

create or replace function app.capability_index(p_staff text default null)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select app.capability_index_core(p_staff)
      || jsonb_build_object('could', app.unused_capabilities())
$$;

comment on function app.capability_index is
  '#51. The office''s capability index, plus `could` — reachable connector '
  'verbs nothing currently uses. Only the gap, not the whole sheet: twenty-five '
  'verbs on every prompt would cost more than they are worth, and an agent can '
  'already read its reach and its tools. Ask app.connector_sheet for the rest.';

grant execute on function app.capability_index_core(text) to ai_team_app;

commit;
