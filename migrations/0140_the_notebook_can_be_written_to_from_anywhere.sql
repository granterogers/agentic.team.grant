-- The notebook can be written to from anywhere now, not only read from.
--
-- 0138 moved READS off the subprocess and said plainly what it had not done:
--
--   "The five `notebook.*` kinds stay where they are. Those are WRITES, and
--    they go through `scripts/notebook/act.py`, which this has not touched.
--    §7 is also stricter about writes than reads — 'never blindly retry an
--    ambiguous Notebook write' — so moving them is a change to make
--    deliberately and on its own, not as a side effect of fixing discovery."
--
-- This is that change, made on its own.
--
-- ## What moved, and what did not
--
-- `act.py` did not move and was not rewritten. `api/notebook-act.py` spawns
-- it — the same fourteen actions, the same quota detection, the same JSON
-- contract on stdout, relayed verbatim. A serverless function spawning a
-- subprocess is not a contradiction of 0138: the point was never that
-- subprocesses are bad, only that the Supabase Edge worker is Deno and cannot
-- have one. Where there is a Python runtime, the work runs there.
--
-- ## The ambiguity §7 cares about
--
-- Moving a write behind HTTP adds a failure that did not exist before: the
-- request times out, and whether it reached Google is unknowable. That is
-- precisely §7's ambiguous write, and it is reported as one — the function
-- answers `timeout: true`, and `HttpActionTransport` raises
-- `AmbiguousWriteError` rather than `NotebookActionError`. The two are
-- deliberately not related by inheritance (see `adapter.ts`) so no single
-- catch can turn a timeout into a retry.
--
-- The same treatment was applied to the subprocess transport on the way past:
-- a killed process was raising an ordinary error, which is the same bug in the
-- older path and nobody had hit it because the older path had no runtime.

begin;

insert into public.system_config (key, value, description)
values
  ('notebook.writer_url',
   to_jsonb('https://ai-team-hq.vercel.app/api/notebook-act'::text),
   'The HTTPS endpoint that performs notebook write actions without a local '
   'subprocess. When this and notebook.reader_secret are both set, every '
   'runtime uses it — including the ones that COULD spawn Python. One '
   'transport everywhere is one transport that gets exercised; a fallback '
   'that only runs on a developer machine is a fallback nobody finds out is '
   'broken.')
on conflict (key) do update set value = excluded.value,
                                description = excluded.description;

-- The five kinds can run anywhere now. Kept in the table rather than deleted,
-- for the same reason `office.sync` was: the next person can see the question
-- was asked and answered.
update public.job_kind_needs
   set needs_subprocess = false,
       why = 'Writes go over HTTPS to api/notebook-act.py, which spawns act.py '
             'on a runtime that has Python (0140). A timeout there is reported '
             'as an ambiguous write, never as a retryable failure.'
 where kind in ('notebook.generate', 'notebook.add_source', 'notebook.push_document',
                'notebook.collect', 'notebook.ask');

do $$
declare v_left integer;
begin
  select count(*) into v_left from public.job_kind_needs where needs_subprocess;
  if v_left <> 0 then
    raise exception '% kind(s) still need a subprocess this system does not have', v_left;
  end if;
end
$$;

commit;
