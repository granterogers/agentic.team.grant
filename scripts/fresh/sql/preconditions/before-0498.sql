-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0498
--
-- 0498 translates NotebookLM's vocabulary into the office's — `slide_deck`
-- becomes `slides`, `mind_map` becomes `mindmap` — and then refuses to believe
-- it worked if nothing of either kind survives:
--
--     'there are now no slide decks or mind maps at all, which is not a fix'
--
-- That is a correct guard against an update that matched everything, and it
-- means the migration needs at least one artifact of each kind to translate.
-- A blank database has none.
--
-- Part of F-002. Written in the OLD vocabulary on purpose: these rows exist to
-- be translated, so writing them as `slides` would satisfy the assertion
-- without exercising the thing being asserted.
-- ---------------------------------------------------------------------------
-- `state = 'ready'` is constrained to carry both a url and a ready_at
-- (`artifacts_ready_has_a_link`), which is the same refusal-to-claim shape as
-- the Telegram bot that may not say it is enabled without a token. Read from
-- `pg_constraint` after the first attempt was refused, not guessed at twice.
insert into public.artifacts (project_id, notebook_ref, kind, state, url, ready_at)
select p.project_id, 'fresh-install-scaffold-notebook', k.kind, 'ready',
       'https://example.invalid/fresh-install-scaffold/' || k.kind, now()
from public.projects p
cross join (values ('slide_deck'), ('mind_map')) as k(kind)
where p.slug = 'legacy-coaching-course'
on conflict do nothing;
