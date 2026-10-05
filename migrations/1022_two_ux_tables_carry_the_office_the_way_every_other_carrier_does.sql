-- 1022: the structural tenant-isolation check (check:office-edges) was blind on the replica from the day the production
-- guard arrived (it imported the production-only guard, so its documented --replica mode was refused, and the mutation
-- proof read that refusal as "the structural check is red"). Corrected to import the replica-capable guard, it reported
-- three real gaps in tables the UX work added:
--
--   document_provenance.document_id pointed at documents(document_id) ALONE, so a provenance row could name a document
--   of another office while carrying its own office_id. Every other carrier points at (id, office_id) so that is impossible;
--   this one does too now.
--   document_provenance and calendar_event_projects had no index led by office_id, which every office-scoped read and the
--   cascade from a deleted office needs.
--
-- Additive and safe on existing rows: office_id is derived from the document when a provenance row is written, so the
-- composite key holds for everything that exists; the statement refuses (and the migration with it) if one does not.

alter table public.document_provenance
  add constraint document_provenance_document_same_office
  foreign key (document_id, office_id) references public.documents (document_id, office_id);

create index if not exists document_provenance_office_idx
  on public.document_provenance (office_id, document_id);

create index if not exists calendar_event_projects_office_idx
  on public.calendar_event_projects (office_id, calendar_id, event_id);
