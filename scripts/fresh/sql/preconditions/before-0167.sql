-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0167
--
-- Staged rather than supplied up front because `public.projects` does not
-- exist until 0002. A precondition is a statement about the database AT A
-- MOMENT IN ITS HISTORY, so its file name says which migration it precedes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- One dashboard project
--
-- Needed by: 0167, whose self-check raises *"voice_state knows of no projects,
-- so a call would know nothing"*. That check is defending something real —
-- 0167's own comment says a function returning valid JSON with nothing in it
-- "looks identical to a working one from every angle except his" — and on
-- Grant's database it passed because he had projects.
--
-- The eight staff come from the migrations themselves and are generic, so the
-- `team` half of the same check needs nothing here.
--
-- NOT named `fixture-`, and that is deliberate in the other direction.
-- `projects.is_fixture` is GENERATED from the slug, and 0167 selects
-- `where p.status = 'active' and not p.is_fixture` — so a fixture-named
-- scaffold is invisible to the very check it exists to satisfy. CLAUDE.md
-- records this exact trap: "A suite that names its subjects `fixture-...`
-- cannot test anything that excludes fixtures."
--
-- The safety therefore has to come from somewhere else, and it does: this row
-- only ever exists inside `fresh_alex_*`, a disposable loopback database the
-- harness drops, and the baseline built from it is SCHEMA ONLY — no row here
-- reaches a fresh user. The name says what it is so that anybody who finds one
-- of these databases knows immediately.
-- ---------------------------------------------------------------------------
insert into public.projects (slug, name, description)
values ('baseline-scaffold-do-not-use', 'Baseline scaffold — do not use',
        'Scaffolding for building the fresh-install baseline. Not a real project. '
        'Exists only inside a disposable fresh_alex_* database.')
on conflict (slug) do nothing;

-- ADR-0014: an ACTIVE project must read from and write to somewhere real, and
-- a trigger enforces it — *"attach a notebook, a Notion database or an upload
-- before activating it"*. `upload` is chosen because it is the only connector
-- that needs no external account at all, which is the same reason a fresh user
-- should be offered it first.
insert into public.project_attachments
  (project_id, connector, external_ref, display_name, role, artifact_kind)
select p.project_id, 'upload', 'fresh-install-baseline-scaffold',
       'Baseline scaffold store', 'home', 'document'
from public.projects p
where p.slug = 'baseline-scaffold-do-not-use'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- A project named "Legacy Coaching Course", with material
--
-- 0167 does not merely require A project. Its self-check reads:
--
--     v := app.voice_lookup('Legacy Coaching Course');
--     if v->>'about' <> 'project' then raise exception ...
--     if jsonb_array_length(v->'material') = 0 then raise exception ...
--
-- That is GRANT'S OWN PROJECT NAME, written into the migration corpus as a
-- literal, with a requirement that it hold documents. The migration cannot
-- apply to any database but his — not because of a credential or a resource id,
-- but because it asserts the CONTENTS of his dashboard.
--
-- Recorded as F-002. The scaffold below satisfies it so the corpus can be
-- replayed to the end and a baseline schema produced; the baseline is structure
-- only, so this name reaches no fresh user. The alternative was to stop at
-- migration 166 of 533 and have nothing.
--
-- The three fixed points of a `documents` row travel together (CLAUDE.md):
-- `content` with a `content_fingerprint`, the fingerprint a real sha256, and
-- `fetched_at` iff there is content. Read from `pg_constraint`, not remembered.
-- ---------------------------------------------------------------------------
insert into public.projects (slug, name, description)
values ('legacy-coaching-course', 'Legacy Coaching Course',
        'Scaffolding: 0167 asserts a project of this exact name holds material.')
on conflict (slug) do nothing;

insert into public.project_attachments
  (project_id, connector, external_ref, display_name, role, artifact_kind)
select p.project_id, 'upload', 'fresh-install-scaffold-lcc',
       'Scaffold store', 'home', 'document'
from public.projects p where p.slug = 'legacy-coaching-course'
on conflict do nothing;

insert into public.documents
  (project_id, connector, title, doc_type, content, content_fingerprint,
   content_chars, fetched_at, external_ref)
select p.project_id, 'upload', 'Scaffold material', 'note',
       'Scaffolding for the fresh-install baseline build. Not real material.',
       encode(extensions.digest(
         'Scaffolding for the fresh-install baseline build. Not real material.', 'sha256'), 'hex'),
       68, now(), 'fresh-install-scaffold-doc-1'
from public.projects p where p.slug = 'legacy-coaching-course'
on conflict do nothing;
