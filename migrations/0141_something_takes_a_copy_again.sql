-- Something takes a copy again.
--
-- The nightly `pg_dump` lived in a GitHub Actions workflow. Actions were
-- switched off on 2026-09-08 at Grant's instruction — *"stop using github
-- actions completely please .. for any process"* — and the backup went with
-- them. Nothing has taken a copy of this database since.
--
-- That was not noticed for a day, which is the ordinary way backups fail: not
-- with an error, but with an absence nobody is looking at.
--
-- ## Not a pg_dump, and why
--
-- `pg_dump` is a binary and the Postgres wire protocol; the only compute left
-- is a Deno Edge Function that has neither. The notebook reader escaped the
-- same corner by measuring its dependency and finding it did not need a
-- browser (0138) — asked here, the answer is genuinely no: a dump needs the
-- binary.
--
-- So the artifact is the one `scripts/backup/export-portable.ts` has produced
-- since Phase 6: every table, the column listing that describes it, and the
-- migration list needed to rebuild the schema, as one gzipped JSON object over
-- the Management API. Restoring means applying the migrations from git and
-- then loading the rows — weaker than one `psql` command, and tractable
-- because the migrations are in git and the loading is now rehearsed
-- (`npm run backup:rehearse`).
--
-- ## Where it goes, and the gap that leaves
--
-- A private bucket in this same Supabase project. That survives losing the
-- code, losing a laptop, and losing every vendor account except one — and it
-- does NOT survive losing the Supabase project, which is the failure §16 most
-- wants covered.
--
-- Sending it further means a new vendor account or emailing Grant his own
-- database, and both are his decision. So the gap is stated here, and in what
-- the handler says every single night, rather than discovered during a
-- restore.
--
-- ## Daily, not hourly
--
-- The archive is the whole database. An hourly copy would be a hundred and
-- sixty-eight near-identical files a week and a bucket nobody can find
-- anything in. Nothing is ever deleted automatically (see the handler), so the
-- period is also the retention policy until Grant sets one.

begin;

insert into public.responsibilities
  (slug, staff_id, description, job_kind, period_minutes, enabled)
select 'nightly-backup', s.staff_id,
       'Take a portable copy of the whole database and keep it in a private '
       'bucket, so losing this machine or this repository does not lose the '
       'work (§16).',
       'office.backup', 1440, true
  from public.staff s where s.slug = 'operations-director'
on conflict (slug) do update
  set enabled = true,
      job_kind = excluded.job_kind,
      period_minutes = excluded.period_minutes,
      description = excluded.description;

-- It reads every table, which is minutes rather than seconds on a database
-- this size, and the default lease is five.
insert into public.system_config (key, value, description)
values
  ('backup.bucket', to_jsonb('backups'::text),
   'The private Storage bucket the nightly copy goes into. Asserted private '
   'before every upload: the avatars bucket beside it is public, and one wrong '
   'flag would put every row in the database at a guessable URL.')
on conflict (key) do nothing;

do $$
declare v_enabled boolean;
begin
  select enabled into v_enabled from public.responsibilities where slug = 'nightly-backup';
  if v_enabled is not true then
    raise exception 'nightly-backup was not enabled';
  end if;
end
$$;

commit;
