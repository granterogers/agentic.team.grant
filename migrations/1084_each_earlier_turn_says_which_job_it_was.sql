begin;

-- Each earlier turn that app.conversation_before returns carries the job it was (COS-053 / COS-083 proof support).
--
-- The reader returned what a turn said, answered, convened and left unfinished, but not WHICH job it was, so a
-- check could only read the window's total. A proof that needs one turn's count (the failed piece it made) had
-- nothing to address it by. `jobId` is the turn's own job id, read from the same inbound command row the other
-- fields come from. Nothing else changes.
--
-- Spliced from the LIVE definition (pg_get_functiondef), and each replacement must match exactly once, so a changed
-- live definition fails here rather than producing a function that does not carry the id.

do $$
declare
  v text := pg_get_functiondef('app.conversation_before(uuid,uuid)'::regprocedure);
  pairs text[][] := array[
    array[
      E'           coalesce(c.transcript, c.instruction) as said,\n',
      E'           coalesce(c.transcript, c.instruction) as said,\n           c.job_id as job_id,\n'
    ],
    array[
      '''waitingOnYou'', waiting_on_you, ''failedUntaken'', failed_untaken)',
      '''waitingOnYou'', waiting_on_you, ''failedUntaken'', failed_untaken, ''jobId'', job_id)'
    ]
  ];
  i int;
  n int;
begin
  -- Idempotent: a database that already carries the id is left as it is.
  if position('''jobId'', job_id' in v) > 0 then
    return;
  end if;
  for i in 1 .. array_length(pairs, 1) loop
    n := (length(v) - length(replace(v, pairs[i][1], ''))) / length(pairs[i][1]);
    if n <> 1 then
      raise exception '1084: expected one occurrence of % in the live conversation_before, found %', pairs[i][1], n;
    end if;
    v := replace(v, pairs[i][1], pairs[i][2]);
  end loop;
  execute v || ';';
end
$$;

commit;
