-- 0061 — NotebookLM back on, at Grant's instruction
--
-- 0048 turned it off when the account was disabled. 0049 recorded the
-- reinstatement and deliberately left it off, pending the decision ADR-0013
-- then made: the project is the source of truth, knowledge tools are
-- connectors, and NotebookLM's unattended client is what the ban named.
--
-- On 2026-09-06 Grant asked for the connection restored. That is his call to
-- make and he made it knowing the reason, so this records the decision rather
-- than re-arguing it.
--
-- ## What has and has not changed
--
-- **The architecture is unchanged.** ADR-0013 still holds and is now load-
-- bearing rather than theoretical: `public.documents` is connector-agnostic,
-- the corpus survives a connector being closed, and retrieval is Postgres
-- full-text search that needs no external service. Turning NotebookLM back on
-- adds a route in; it does not make the notebook the store again. That is
-- precisely why this is a one-row change and not a migration of any substance.
--
-- **The risk is unchanged too, and it is worth being exact about which risk.**
-- Not that the credential will stop working — it works, verified today: three
-- notebooks, `available_unofficial`, the account authenticating. The risk is
-- that Google's policy on programmatic access has not changed, the appeal
-- reversed a penalty and not a rule, and an unattended client polling every ten
-- minutes is the behaviour that drew the penalty. If it happens again the cost
-- is now much lower than it was, because everything the notebook feeds is
-- cached in `documents` and nothing else depends on the account.
--
-- ## The finding that came with it
--
-- The adapter is a Python library, `notebooklm-py`, and nothing installs it.
-- It was present in an earlier container, that container was reclaimed, and the
-- probe therefore reported `unavailable` with `No module named 'notebooklm'` —
-- an integration that is broken by default in every fresh environment and looks
-- from the outside exactly like an expired credential. `npm run setup:python`
-- installs it, and `npm run inventory` now reports whether it is importable.

begin;

update public.system_config
   set value = 'true'::jsonb,
       description = 'NotebookLM adapter. Re-enabled 2026-09-06 at Grant''s instruction, '
                     'with the credential verified the same day (3 notebooks, '
                     'available_unofficial). ADR-0013 is unchanged: this is a route in, '
                     'not the store.'
 where key = 'notebook.enabled';

update public.knowledge_connectors
   set enabled = true,
       disabled_reason = null,
       notes = 'Re-enabled 2026-09-06 at Grant''s instruction. No public API, so the '
               'client impersonates a browser session - the behaviour the 2026-09-04 ban '
               'named. Everything it feeds is cached in public.documents, so if the '
               'account goes again the corpus stays (ADR-0013).'
 where connector = 'notebooklm';

commit;
