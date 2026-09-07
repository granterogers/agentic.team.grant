-- 0049 — the Google account was reinstated
--
-- Grant appealed and Google restored `agentic.team.grant@gmail.com` on
-- 2026-09-05, a day after disabling it. Verified rather than taken on trust:
-- the NotebookLM master token mints an access token again, and the Gemini API
-- key returns a model list instead of `401 ACCOUNT_STATE_INVALID`.
--
-- ## What this changes, and what it does not
--
-- The stated reason for turning Notebook off in 0048 — "the account it
-- authenticates as was disabled" — is no longer true, so leaving that text in
-- place would be a lie of the kind this project keeps writing migrations to
-- correct. The reason is updated.
--
-- **The integration stays off.** Not out of caution theatre, and not because
-- anyone forgot to switch it back: ADR-0012 asked a question that a
-- reinstatement does not answer.
--
--   * The ban was for using the account in a way Google's policies forbid. The
--     appeal reversed the penalty, not the policy. NotebookLM still has no
--     public API, and the automation is still against the grain of the terms.
--   * A system whose knowledge layer can be removed overnight by a policy sweep
--     has that property whether or not the sweep has happened recently.
--   * The cost of moving is at its lowest right now — one source, three
--     project references, and the source text already cached in Postgres.
--
-- So the choice between "re-enable and accept the risk" and "move the knowledge
-- layer into Postgres" is Grant's, is unchanged by the good news, and is
-- deliberately left open. Re-enabling is one UPDATE, and this migration records
-- exactly what it would be.
--
-- What the reinstatement DOES settle: Phase 9 is unblocked. Calendar, Gmail and
-- Drive were always going to read Grant's own data through supported OAuth, and
-- the client that had been under this project belongs to a project that exists
-- again.

begin;

update public.system_config
   set value = 'false'::jsonb,
       description = 'Notebook integration, OFF. The 2026-09-04 account ban was reversed on 2026-09-05 and the credentials work again (verified), so the original blocker is gone. It stays off pending ADR-0012, which asks whether the knowledge layer should depend on an automation with no public API at all - a question a reinstatement does not answer. To re-enable: set this to true. Nothing else is required.'
 where key = 'notebook.enabled';

update public.system_config
   set value = '"awaiting_adr_0012_decision"'::jsonb,
       description = 'Why the Notebook integration is off. Was google_account_disabled_2026_09_04; the account was reinstated 2026-09-05 and the reason is now the open architectural decision rather than a dead credential.'
 where key = 'notebook.disabled_reason';

commit;
