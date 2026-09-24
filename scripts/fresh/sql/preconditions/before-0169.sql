-- ---------------------------------------------------------------------------
-- HISTORICAL PRECONDITION, applied immediately before migration 0169
--
-- 0169 is a DATA REPAIR migration that refuses to be a no-op. It links every
-- Notion copy of a document to the original it mirrors, and then raises:
--
--     'nothing was adopted as a mirror: % documents, % originals — the course
--      still reads as having twice the material it has'
--
-- On Grant's database there were sixteen such pairs, left by an import. On any
-- other database there are none, and a repair with nothing to repair correctly
-- refuses to claim it did something — which is good behaviour that makes the
-- migration unapplicable anywhere else.
--
-- Part of F-002: a migration asserting the CONTENTS of Grant's dashboard.
--
-- The pair below matches 0169's second rule — same project, same normalised
-- title, `notion` against something that is not `notion` — because the first
-- rule needs identical fingerprints and a mirror whose bytes match exactly is
-- not what that rule was written for.
-- ---------------------------------------------------------------------------
insert into public.documents
  (project_id, connector, title, doc_type, content, content_fingerprint,
   content_chars, fetched_at, external_ref)
select p.project_id, 'notion', 'Scaffold material', 'note',
       'Scaffolding, as Notion round-tripped it. Not real material.',
       encode(extensions.digest(
         'Scaffolding, as Notion round-tripped it. Not real material.', 'sha256'), 'hex'),
       58, now(), 'fresh-install-scaffold-doc-1-notion'
from public.projects p where p.slug = 'legacy-coaching-course'
on conflict do nothing;
