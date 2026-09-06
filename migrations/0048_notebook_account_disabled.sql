-- 0048 — Notebook is off, because the account it ran on was disabled
--
-- Google disabled `agentic.team.grant@gmail.com` on 2026-09-04, stating that it
-- "was created or used with multiple other accounts to violate Google's
-- policies" and "might have been created by a computer program or bot". It is
-- scheduled for deletion on 2027-07-31.
--
-- Verified rather than assumed, on 2026-09-05: minting an access token from the
-- stored master token returns `403 BadAuthentication`. The credential is not
-- expired, it is refused. This also explains `GEMINI_API_KEY` returning "the
-- bound service account is deleted or disabled" — same account, and the API key
-- died with it.
--
-- ## What this migration does, and why it is a migration at all
--
-- §17 requires every integration to be independently disableable, and this is
-- what that is for. Left enabled, the sync would keep trying, keep failing, and
-- keep filling the log with an error that reads like a transient fault. Turned
-- off with the reason recorded, "why is Notebook not syncing" has an answer that
-- survives the person who knew.
--
-- ## What it costs, measured
--
--   * 118 projects exist. **3** have a `notebook_ref`.
--   * 1 notebook source is recorded.
--   * 0 live jobs need Notebook.
--
-- That is the whole of the damage, and it is small because ADR-0003 and §7 made
-- Notebook a replaceable adapter rather than the system's memory: *"Postgres
-- owns this, never Notebook — a Notebook outage is a degraded mode, not amnesia
-- about which projects exist."* The projects, the jobs, the ledger, the
-- briefings and every delivery are untouched. This is the decision paying out.
--
-- The credentials stay in the vault rather than being deleted. They are
-- evidence of what was configured, they are already useless, and deleting them
-- would make the appeal harder to reason about if it succeeds.

begin;

update public.system_config
   set value = 'false'::jsonb,
       description = 'Notebook integration. Disabled 2026-09-05: the Google account it authenticates as (agentic.team.grant@gmail.com) was disabled by Google on 2026-09-04. Master token returns 403 BadAuthentication. Re-enable only after a working credential exists AND the account question in docs/adr/ is settled - see 0048.'
 where key = 'notebook.enabled';

insert into public.system_config (key, value, description, self_adjustable)
values (
  'notebook.disabled_reason',
  '"google_account_disabled_2026_09_04"'::jsonb,
  'Why the Notebook integration is off. A code rather than prose so a dashboard can branch on it; the prose is on notebook.enabled and in migration 0048.',
  false
)
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

commit;
