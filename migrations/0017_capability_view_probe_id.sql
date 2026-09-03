-- 0017 — expose probe_id on the capability view
--
-- `notebook_budgets.probe_id` is NOT NULL by design: §11 forbids hard-coded
-- quota, and a budget with no provenance is a hard-coded number with extra
-- steps. But `public.notebook_capability` — the view that says which probe is
-- current — did not project `probe_id`, so nothing could satisfy that
-- constraint from the current probe.
--
-- Found by the first live sync, which failed on it and recorded the failure as
-- a degraded run rather than crashing. That is Phase 4's "Notebook outage
-- degrades rather than fails" behaving correctly on a bug that was not an
-- outage, which is a better test of it than an outage would have been.

begin;

-- probe_id is appended LAST rather than put first, which reads oddly and is
-- required: `create or replace view` may only add columns at the end. Leading
-- with it fails with 42P16 "cannot change name of view column", because
-- Postgres matches columns positionally. Dropping and recreating the view
-- would allow any order and would also silently drop anything depending on it,
-- which is a worse trade for a cosmetic one.
create or replace view public.notebook_capability as
  select state, capabilities, adapter, adapter_version, detected_tier,
         notebook_limit, source_limit, detail, latency_ms, probed_at,
         probe_id
  from public.notebook_capability_probes
  order by probed_at desc
  limit 1;

comment on view public.notebook_capability is
  'Current capability, derived from the newest probe rather than stored '
  'separately - a stored current-state row can disagree with its own history. '
  'probe_id is projected so a derived budget can cite the probe it came from.';

commit;
