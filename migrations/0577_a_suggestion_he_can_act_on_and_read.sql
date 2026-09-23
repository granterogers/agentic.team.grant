/*
  "We have been unable to an answer the database will accept 46 times."

  That sentence was on Grant's Governance page. Two defects in one line, and
  0474 fixed both of them for PROPOSALS three days ago without carrying either
  across to the sentence beside it.

  `app.notice`'s `blocked_capability` branch composes

      format('We have been unable to %s %s times in the last fortnight.',
             replace(i.needed, '-', ' '), i.times)

  over every row `impediments_tally` returns.

  **The template assumes `needed` is a verb phrase and half of them are
  nouns.** 0474 records the same thing about proposals: *"a title built as
  `%s cannot %s` assumes `needed` is a verb phrase, and half of them are nouns
  — `could not:` reads correctly for both."*

  **And it does not skip `not_capable`.** 0474 skips that kind for proposals
  because it is #185's coherence gate refusing an answer — the gate WORKING —
  and there is nothing in it for Grant to approve. Two of the three
  suggestions raised were exactly that: *"unable to an answer that matches its
  own evidence"*, which is the office declining to fabricate, offered to him
  as something he might fix.

  The third suggestion the round raised is genuinely useful and is kept:
  *"Direct messages and uploads has been attached to Unnamed since 13 Sep and
  has produced nothing."*

  Nothing had ever run this round, which is why neither defect had been seen —
  see 0578 for the caller and #351 for how that hid.
*/

do $patch$
declare
  v_src text := pg_get_functiondef('app.notice'::regproc);
  v_new text;
begin
  v_new := replace(v_src,
    $old$    select 'capability_missing'::text, null::uuid, i.needed,
           format('We have been unable to %s %s times in the last fortnight.',
                  replace(i.needed, '-', ' '), i.times),$old$,
    $new$    select 'capability_missing'::text, null::uuid, i.needed,
           /*
             `could not:` reads for a noun AND a verb phrase (0474, 0577).
             "We have been unable to an answer the database will accept" was
             on his page; half of what `needed` holds is a noun.
           */
           format('Could not: %s — %s times in the last fortnight.',
                  replace(i.needed, '-', ' '), i.times),$new$);

  v_new := replace(v_new,
    $old$      from public.impediments_tally(14, 3) i
  )$old$,
    $new$      from public.impediments_tally(14, 3) i
     /*
       NOT the coherence gate refusing an answer (0474's rule, carried across).

       `not_capable` is overwhelmingly #185's gate declining to let the office
       claim something it did not do. That is the gate working, there is
       nothing in it for Grant to approve, and offering it to him as a
       capability he might grant reads as the office asking permission to
       fabricate.
     */
     where i.kind <> 'not_capable'
  )$new$);

  if v_new = v_src then
    raise exception 'the splice matched nothing — app.notice has been reworded';
  end if;
  execute v_new || ';';
end
$patch$;

do $drive$
declare
  v_bad int;
  v_job uuid;
  v_body text;
begin
  /* Nothing the gate refused is offered to him as a capability. */
  select count(*) into v_bad from app.notice(40) n
   where n.body like '%matches its own evidence%'
      or n.body like '%an answer the database will accept%';
  if v_bad > 0 then
    raise exception '% coherence-gate refusal(s) are still offered as suggestions', v_bad;
  end if;

  /* And no sentence reads "unable to a/an <noun>" any more. */
  select count(*) into v_bad from app.notice(40) n where n.body ~ 'unable to (a|an|the) ';
  if v_bad > 0 then
    raise exception '% suggestion(s) still read as a broken sentence', v_bad;
  end if;

  /*
    THE POSITIVE CONTROL, and the first version of it was wrong.

    It asserted that `app.notice` still returns SOMETHING — and the migration
    failed, because `impediments_tally(14, 3)` currently holds ONLY
    `not_capable` (4 rows, 58 occurrences). Excluding that kind empties the
    branch, correctly: every recurring impediment the office has is the
    coherence gate working, and there is nothing in any of them for Grant.

    Demanding output was the wrong question. What must be true is that the
    branch still WORKS when there is something to say, so this makes something
    to say — inside a subtransaction, because `job_impediments` refuses DELETE
    and a rollback is not a delete.
  */
  begin
    insert into public.jobs (kind, requested_by, state, correlation_id, idempotency_key)
    values ('office.instruction', 'telegram:grant', 'queued', gen_random_uuid(), 'notice-drive-0577')
    returning job_id into v_job;

    perform app.cannot(v_job, 'missing_tool', 'a spreadsheet to read',
                       'the drive', 'no such tool', 'reading the numbers');
    perform app.cannot(v_job, 'missing_tool', 'a spreadsheet to read',
                       'the drive', 'no such tool', 'reading the numbers');
    perform app.cannot(v_job, 'missing_tool', 'a spreadsheet to read',
                       'the drive', 'no such tool', 'reading the numbers');

    select n.body into v_body from app.notice(40) n
     where n.body like '%spreadsheet to read%' limit 1;

    if v_body is null then
      raise exception 'the branch no longer notices a real missing tool at all';
    end if;
    if v_body !~ '^Could not: a spreadsheet to read — 3 times' then
      raise exception 'the sentence reads: %', v_body;
    end if;

    raise exception 'rollback-the-fixtures';
  exception
    when others then
      if sqlerrm <> 'rollback-the-fixtures' then raise; end if;
  end;
end
$drive$;
