/*
  Thirty-four reversals the office recorded and cannot perform.

  `public.undoable_actions` holds 377 rows. `app.hq_undo` dispatches on
  `reversal ->> 'action'` through a CLOSED case and raises
  `no way to perform the reversal %` on anything it does not know. Four of the
  recorded actions are not in that case:

      contact_archive      13
      contact_photo_set     8
      contact_update       10
      document_rename       3

  So pressing Undo on any of those thirty-four raises out of a SECURITY
  DEFINER function. Not a refusal - an error.

  CLAUDE.md states the rule twice and this is the third instance of it:
  *"An offer may only promise what the press can perform"*, and, about this
  exact function, *"teach `hq_undo` the verb in the same migration that starts
  offering it, and drive the press."*

  The near-miss is the tell. `hq_undo` knows `contact_fields_set` and
  `contact_labels_set`; the writers record `contact_update` and
  `contact_archive`. The writer and the dispatcher grew two vocabularies for
  one set of things - 0311's defect, on the mechanism Grant's *"always check
  before making any destructive action"* depends on.

  The payloads were never the problem: `contact_update` carries all fourteen
  of `hq_contact_update`'s arguments, and the other three carry exactly what
  their performer takes. Only the dispatch was missing.

  Spliced from the LIVE definition rather than retyped, because this file
  already records what rewriting a function from memory costs - and terminated
  with a semicolon, because `pg_get_functiondef` emits none.
*/

do $patch$
declare
  v_src text;
  v_new text;
begin
  v_src := pg_get_functiondef('app.hq_undo'::regproc);

  if v_src !~ 'no way to perform the reversal' then
    raise exception 'hq_undo no longer has the closed case this migration patches';
  end if;
  if v_src ~ 'when ''contact_update'' then' then
    raise exception 'hq_undo already knows contact_update - has this been applied twice?';
  end if;

  v_new := replace(
    v_src,
    '    else' || chr(10) ||
    '      -- A reversal naming something this function cannot perform is a bug in',
    '    -- The four the writers have always recorded and this case never knew' || chr(10) ||
    '    -- about (0572). Each one calls the same function the dashboard calls,' || chr(10) ||
    '    -- so undoing goes through the same door as doing.' || chr(10) ||
    '    when ''contact_update'' then' || chr(10) ||
    '      v_did := app.hq_contact_update((v_args ->> ''p_contact_id'')::uuid,' || chr(10) ||
    '                                     v_args ->> ''p_name'', v_args ->> ''p_role'',' || chr(10) ||
    '                                     v_args ->> ''p_org'', v_args ->> ''p_email'',' || chr(10) ||
    '                                     v_args ->> ''p_phone'', v_args ->> ''p_website'',' || chr(10) ||
    '                                     v_args ->> ''p_instagram'', v_args ->> ''p_where'',' || chr(10) ||
    '                                     v_args ->> ''p_note'', v_args ->> ''p_kind'',' || chr(10) ||
    '                                     v_args ->> ''p_stage'', v_args ->> ''p_next'',' || chr(10) ||
    '                                     v_args ->> ''p_next_due'');' || chr(10) ||
    '    when ''contact_archive'' then' || chr(10) ||
    '      v_did := app.hq_contact_archive((v_args ->> ''p_contact_id'')::uuid,' || chr(10) ||
    '                                      (v_args ->> ''p_put_away'')::boolean);' || chr(10) ||
    '    when ''contact_photo_set'' then' || chr(10) ||
    '      v_did := app.hq_contact_photo_set((v_args ->> ''p_contact_id'')::uuid,' || chr(10) ||
    '                                        v_args ->> ''p_path'');' || chr(10) ||
    '    when ''document_rename'' then' || chr(10) ||
    '      v_did := app.rename_document((v_args ->> ''p_document'')::uuid,' || chr(10) ||
    '                                   v_args ->> ''p_title'');' || chr(10) ||
    '    else' || chr(10) ||
    '      -- A reversal naming something this function cannot perform is a bug in');

  if v_new = v_src then
    raise exception 'the splice matched nothing - hq_undo''s else branch has been reworded';
  end if;

  execute v_new || ';';
end
$patch$;

/*
  THE PROPERTY, over the real rows rather than over a list.

  Not "the four names are present" - that is the artefact, and this file
  records four occasions where asserting the artefact went red on a correct
  change. The invariant is that nothing the office has RECORDED as reversible
  names something the press cannot perform.
*/
do $drive$
declare
  v_src text := pg_get_functiondef('app.hq_undo'::regproc);
  v_orphan text;
  v_n int;
begin
  select string_agg(distinct a.reversal ->> 'action', ', '), count(*)
    into v_orphan, v_n
    from public.undoable_actions a
   where a.reversal ->> 'action' is not null
     and v_src !~ ('when ''' || (a.reversal ->> 'action') || ''' then');

  if coalesce(v_n, 0) > 0 then
    raise exception 'hq_undo still cannot perform % recorded reversal(s): %', v_n, v_orphan;
  end if;

  -- And the control, because a check whose happy path is "found nothing" must
  -- first prove the thing it searches is non-empty.
  select count(*) into v_n from public.undoable_actions where reversal ->> 'action' is not null;
  if v_n = 0 then
    raise exception 'no recorded reversals at all - the check above proved nothing';
  end if;

  -- And that the case is still closed, so an unknown name is still refused
  -- rather than silently ignored.
  if v_src !~ 'no way to perform the reversal' then
    raise exception 'hq_undo no longer refuses a reversal it does not know';
  end if;
end
$drive$;
