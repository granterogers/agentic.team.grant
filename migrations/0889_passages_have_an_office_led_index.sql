-- 0888's document_chunks had indexes led by the document and by the text, and none led by the office; check:office-edges
-- requires one on every office-carrying table (a per-office read, a per-office count and the backfill of a re-parented
-- office all start there).
create index document_chunks_office_idx on public.document_chunks (office_id, document_id);
