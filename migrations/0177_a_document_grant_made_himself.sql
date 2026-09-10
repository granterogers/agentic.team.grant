-- A document Grant made himself.
--
-- `documents.connector` is NOT NULL. Every one of the 55 rows in there arrived
-- through Notion, NotebookLM or MCP, so the constraint has never been tested —
-- and it means the schema **cannot represent a file Grant uploaded**. Found by
-- `npm run verify:assets` on its first run, inserting exactly that.
--
-- This is the heart of #9 ("documents cannot represent a file") reached from a
-- different direction, and it makes `origin = 'yours'` from 0175 unreachable:
-- there is no way to write a row that is not from a connector.
--
-- ## Why nullable rather than a 'none' sentinel
--
-- A sentinel would satisfy the constraint and lie. `connector = 'none'` reads
-- as a connector called none in every join, group-by and health count, and the
-- first report that groups by connector shows "none — 41" as though it were a
-- service. Null means what it means: this did not come from anywhere else.
--
-- ## The invariant that replaces it
--
-- The old constraint was doing something real — it stopped a row appearing with
-- no provenance at all. That is worth keeping, so it is restated correctly:
-- something with `origin = 'source'` must name its connector, and something
-- with `origin = 'yours'` or `'made'` must not, because it did not come from
-- one. Stronger than NOT NULL, and true.

begin;

alter table public.documents alter column connector drop not null;

-- Every existing row came from a connector and 0175 already marked them
-- `source`; this states the rule that keeps it that way.
alter table public.documents
  drop constraint if exists connector_matches_origin;
alter table public.documents
  add constraint connector_matches_origin
  check (
    (origin = 'source' and connector is not null and length(btrim(connector)) > 0)
    or (origin in ('yours', 'made') and (connector is null or btrim(connector) = ''))
  );

commit;
