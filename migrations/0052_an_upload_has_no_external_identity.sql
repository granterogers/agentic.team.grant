-- 0052 — an upload has no external identity
--
-- 0051 made the uniqueness index partial (`where external_ref is not null`),
-- on the stated reasoning that a directly uploaded document has no id in any
-- other system and inventing one would be a fabricated key. It then left the
-- columns `not null`, inherited from 0015 where every row came from a notebook
-- and a remote id was therefore guaranteed.
--
-- So the partial index guarded against a case the table could not represent:
-- inserting an upload failed with 23502 before uniqueness was ever consulted.
-- The index was written for the design and the columns for the history.
--
-- Found by `verify:knowledge` on its first run, which is the argument for
-- writing the suite in the same session as the schema: the migration applied
-- cleanly, and "it applied" says nothing about whether the rows it permits are
-- the rows the design intended.

begin;

alter table public.documents alter column external_ref drop not null;
alter table public.documents alter column external_parent_ref drop not null;

-- A connector-fed document is identified by BOTH refs together, which is what
-- the uniqueness index keys on. A parent with no ref would be half an identity:
-- unique against nothing, and indistinguishable from an upload.
alter table public.documents
  add constraint documents_external_identity_is_whole
  check (external_parent_ref is null or external_ref is not null);

comment on column public.documents.external_parent_ref is
  'The container the document came from - a notebook, a Notion database - or '
  'null for an upload, which came from nowhere but here. Null together with '
  'external_ref, never half-set: see documents_external_identity_is_whole.';

commit;
