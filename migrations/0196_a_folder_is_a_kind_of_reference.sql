-- A folder is a kind of reference.
--
-- Issue #62. 0194 attached a Drive folder with `ref_kind = 'folder'` and the
-- constraint refused it:
--
--     new row for relation "project_attachments" violates check constraint
--     "project_attachments_ref_kind_known"
--
-- The known kinds were database, data_source, page, notebook, repository — the
-- five that existed when Notion, NotebookLM and GitHub were the only
-- connectors. Drive's unit is a folder and nobody had needed one.
--
-- The constraint did exactly what it is for. An enumerated check that refuses a
-- value nobody has declared is the whole point of having it — the alternative
-- is a free-text column where 'folder', 'Folder' and 'drive_folder' coexist and
-- every query has to know all three. So this widens the list deliberately
-- rather than removing the check.
--
-- `file` is added at the same time, unused today. Not speculative: the Drive
-- watcher already distinguishes a folder from the files inside it, and the
-- first time a single shared document is attached to a project — which is the
-- obvious next request after "watch this folder" — it will need somewhere to
-- say so.

begin;

alter table public.project_attachments
  drop constraint if exists project_attachments_ref_kind_known;

alter table public.project_attachments
  add constraint project_attachments_ref_kind_known
    check (
      ref_kind is null
      or ref_kind = any (array[
        'database',     -- Notion
        'data_source',  -- Notion, the queryable half of a database
        'page',         -- Notion
        'notebook',     -- NotebookLM
        'repository',   -- GitHub
        'folder',       -- Google Drive
        'file'          -- Google Drive, a single document
      ])
    );

comment on constraint project_attachments_ref_kind_known on public.project_attachments is
  'What the external_ref points AT. Enumerated so that folder, Folder and '
  'drive_folder cannot coexist and force every query to know all three; '
  'widened deliberately when a connector brings a new unit (0196).';

commit;
