-- Backup inventory for the capacity baseline (12 October 2026). READ-ONLY: plain selects, run through the Management API's read-only endpoint
-- (scripts/release/preflight-read.ts). They read storage.objects METADATA only (run folder names, object names inside a run, counts, sizes, times): no object is downloaded.
--
-- B01 one row per backup run (top-level folder or legacy file): objects, bytes, newest object time, whether a manifest is present.
select split_part(name, '/', 1) as run, count(*) as objects, sum(coalesce((metadata ->> 'size')::bigint, 0)) as bytes, min(created_at) as first_at, max(created_at) as last_at, bool_or(name like '%/manifest.json.gz') as has_manifest from storage.objects where bucket_id = 'backups' group by 1 order by 5 desc

-- B02 what changed between the nights of 9 and 10 October: the largest objects by name in the three newest runs (object names inside a run are table names).
select regexp_replace(name, '^run-[0-9a-f-]+/', '') as object, max(case when created_at >= timestamptz '2026-10-11' then (metadata ->> 'size')::bigint end) as sz_oct11, max(case when created_at >= timestamptz '2026-10-10' and created_at < timestamptz '2026-10-11' then (metadata ->> 'size')::bigint end) as sz_oct10, max(case when created_at >= timestamptz '2026-10-09' and created_at < timestamptz '2026-10-10' then (metadata ->> 'size')::bigint end) as sz_oct09 from storage.objects where bucket_id = 'backups' and name like 'run-%' and created_at >= timestamptz '2026-10-09' group by 1 order by 2 desc nulls last limit 12
