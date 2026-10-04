-- check:office-edges reads a link between two owned tables as TWO constraints: the plain foreign key on the column, and a
-- composite (column, office_id) key named <fk>_same_office that makes a cross-office row impossible. 0888 had only the
-- composite one, under a name the check does not recognise. Same behaviour, the repository's convention.
alter table public.document_chunks drop constraint document_chunks_document_same_office;
alter table public.document_chunks
  add constraint document_chunks_document_id_fkey
    foreign key (document_id) references public.documents(document_id) on delete cascade;
alter table public.document_chunks
  add constraint document_chunks_document_id_same_office
    foreign key (document_id, office_id) references public.documents(document_id, office_id) on delete cascade;
