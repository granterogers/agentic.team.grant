-- Discovery needs no machine of its own.
--
-- 0137 recorded the honest state: six job kinds needed a local subprocess, and
-- the only worker left is a Deno Edge Function that has none. The conclusion
-- drawn from that was "these wait for a runtime that does not exist", and the
-- next step looked like renting one.
--
-- It was not necessary. Measuring the dependency instead of assuming it:
-- `notebooklm-py` requires `click`, `filelock`, `httpx` and `rich`. Playwright
-- appears only on the LOGIN path, which happens once, by hand, and already
-- happened — the cookie jar has been in the vault since Phase 4. So a notebook
-- READ is an ordinary HTTPS call in a few hundred kilobytes of pure Python.
--
-- That fits in a serverless function on the Vercel project already serving
-- Team HQ: `api/notebook.py`, speaking the same four operations
-- `scripts/notebook/read.py` does, with the same JSON shapes. No new account,
-- no card, no GitHub Actions. Measured at 1.9 seconds for a full probe against
-- the live account.
--
-- ## What this changes and what it does not
--
-- `office.sync` reads and never writes, so it runs anywhere now.
--
-- The five `notebook.*` kinds stay where they are. Those are WRITES, and they
-- go through `scripts/notebook/act.py`, which this has not touched. §7 is also
-- stricter about writes than reads — "never blindly retry an ambiguous
-- Notebook write" — so moving them is a change to make deliberately and on its
-- own, not as a side effect of fixing discovery.

begin;

-- Where the reader lives. Configuration, not a constant in the adapter: the
-- deployment URL is a fact about this installation, and §4 keeps facts about
-- an installation out of code.
insert into public.system_config (key, value, description)
values
  ('notebook.reader_url',
   to_jsonb('https://ai-team-hq.vercel.app/api/notebook'::text),
   'The HTTPS endpoint that reads Gemini Notebook without a subprocess. '
   'Deployed by `npm run deploy:hq` alongside the page, because a Vercel '
   'deployment is an atomic file list and deploying one without the other '
   'would delete the other.')
on conflict (key) do update set value = excluded.value,
                                description = excluded.description;

-- Discovery no longer needs a machine.
update public.job_kind_needs
   set needs_subprocess = false,
       why = 'Reads only, and reads now go over HTTPS to api/notebook.py '
             '(0138). Kept in this table rather than deleted, so the next '
             'person can see that the question was asked and answered.'
 where kind = 'office.sync';

-- ---------------------------------------------------------------------------
-- And switch the duty on
-- ---------------------------------------------------------------------------
--
-- 0133 seeded it disabled with a rule attached: *"switched on in the same
-- change that adds each handler."* `src/handlers/sync.ts` is that handler and
-- the runtime underneath it now exists, so this is that change.
--
-- Hourly, as seeded. §22 scenario A says "detected within the sync interval"
-- and does not say what the interval is; an hour is the interval the duty was
-- written with, and shortening it is a decision to take against measured
-- quota use rather than in advance.

update public.responsibilities
   set enabled = true
 where slug = 'discovery-sync';

do $$
declare v_enabled boolean;
begin
  select enabled into v_enabled from public.responsibilities where slug = 'discovery-sync';
  if v_enabled is not true then
    raise exception 'discovery-sync was not enabled — is the duty row missing?';
  end if;
end
$$;

commit;
