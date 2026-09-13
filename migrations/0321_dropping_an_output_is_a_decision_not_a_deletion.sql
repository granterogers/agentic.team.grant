begin;

/**
 * Dropping an output is a decision, not a deletion.
 *
 * #28's gate has two answers and 0315–0320 built one of them. The other is
 * "no", and it must be as durable as the yes — until now it was a key in
 * `localStorage`, so declining a finding on a laptop left it waiting for review
 * on a phone.
 *
 * `outputs.reviewer_status` already has `rejected` in its enum and nothing had
 * ever set it. `studio_requests` reads that column to decide whether a card is
 * still awaiting review, so this is the whole of the change: the state existed
 * and had no writer.
 *
 * Nothing is deleted. §16's argument is that the ledger of what the office
 * produced and what Grant did with it is the point, and a row that was
 * declined and then removed cannot be counted, learned from, or undone. There
 * is an `undo` on the card for exactly that reason, and it needs something to
 * return to.
 *
 * `review_notes` carries the WHY when there is one. #59 made a thumbs-down
 * invite the correction rather than swallowing it, and the same argument holds
 * here: "no" with a reason is a thing the office can learn from, and "no" on
 * its own is an event.
 */

create or replace function app.decide_output(
  p_output uuid,
  p_verdict text,
  p_why text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_now text; v_job uuid;
begin
  /*
    Only the two a person presses.

    `approved` is deliberately NOT settable here: an output becomes approved by
    being IMPORTED (0317), which is the step that creates the document. Letting
    a button set the status directly would produce an output marked approved
    with nothing in the project — the half-built gate this Issue is about.
  */
  if p_verdict not in ('rejected', 'pending') then
    return jsonb_build_object('ok', false, 'error',
      format('%s is not a decision this can make — import it to approve it', p_verdict));
  end if;

  select oo.reviewer_status::text, oo.job_id into v_now, v_job
    from public.outputs oo where oo.output_id = p_output;
  if v_now is null then
    return jsonb_build_object('ok', false, 'error', 'no such output');
  end if;

  update public.outputs
     set reviewer_status = p_verdict::reviewer_status,
         reviewed_at = case when p_verdict = 'pending' then null else app.now_utc() end,
         review_notes = nullif(btrim(coalesce(p_why, '')), '')
   where output_id = p_output;

  return jsonb_build_object('ok', true, 'was', v_now, 'now', p_verdict, 'job', v_job);
end;
$$;

comment on function app.decide_output is
  '#28. The other half of the import gate — declining an output, and undoing '
  'that. `approved` is not settable here on purpose: an output becomes '
  'approved by being IMPORTED, and a button that set the status alone would '
  'leave it marked approved with nothing in the project. 0321.';

create or replace function public.decide_output(p_output uuid, p_verdict text, p_why text default null)
returns jsonb language sql security definer set search_path = public, pg_catalog
as $$ select app.decide_output(p_output, p_verdict, p_why) $$;

grant execute on function app.decide_output(uuid, text, text) to ai_team_app;
grant execute on function public.decide_output(uuid, text, text) to ai_team_app;

commit;
