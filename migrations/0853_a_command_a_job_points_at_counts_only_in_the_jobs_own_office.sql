-- 0853 - the command a job points at counts only in the job's OWN office (multi-user P3, k-worker-internal).
--
-- Two defects found in the originals, one cause: a command id written into a job (its idempotency key, its pinned config) is DATA, and
-- two readers looked the command up by id alone.
--
--   * app.harness_job asks whether the inbound command named in `pinned_config.command_id` was written by a harness (its dedupe key).
--     A job of office A whose config named a HARNESS command of office B read as harness traffic. The predicate decides what a
--     briefing counts, what a delivery guard suppresses and which jobs a reader hides, so a foreign command id could change how
--     another office's job is classified.
--   * app.jobs_stamp_origin (the trigger that records where a job came from) finds the command an `inbound-<uuid>` key names by id
--     alone. A job of A filed under B's command id, with B's subject, was stamped as that command's inbound turn, carrying B's
--     origin class (trusted, or harness). The job and the command it is made from are one office, so a command of another office
--     reads exactly as a command that does not exist: the job is recorded as an inbound turn the office cannot find, and unknown.
--     (A row written before its office is known - new.office_id null - keeps the old lookup.)
--
-- The other readers of the same pointer (job_origin, owed_a_word, job_forwarded) already compare the command's office to the job's.
-- Both functions are spliced from their LIVE definitions, asserting each anchor lands exactly once.

do $m$
declare
  v text;
  r record;
begin
  for r in
    select * from (values
      ('app.harness_job(uuid)'::text,
       'where c.command_id = (j.pinned_config ->> ''command_id'')::uuid',
       'where c.command_id = (j.pinned_config ->> ''command_id'')::uuid and c.office_id = j.office_id'),
      ('app.jobs_stamp_origin()',
       'select * into c from public.inbound_commands where command_id = v_cmd;',
       'select * into c from public.inbound_commands where command_id = v_cmd and (new.office_id is null or office_id = new.office_id);')
    ) as x(fn, anchor, repl)
  loop
    v := pg_get_functiondef(r.fn::regprocedure);
    if (length(v) - length(replace(v, r.anchor, ''))) / length(r.anchor) <> 1 then
      raise exception '0853 splice anchor for % must occur exactly once', r.fn;
    end if;
    v := replace(v, r.anchor, r.repl);
    execute v;
  end loop;
end
$m$;
