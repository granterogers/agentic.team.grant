/*
  Two more reversals the press cannot perform, and no row could have shown
  them.

  0572 taught `app.hq_undo` the four action names that were sitting in
  `public.undoable_actions` unperformable. `npm run check:undo`, written in the
  same hour, reads the WRITERS rather than the recorded rows - and found two
  more on its first run:

      document_move      recorded by app.hq_document_move
      document_restore   recorded by app.hq_document_supersede

  Nobody has ever moved or superseded a document, so neither has a row, so
  neither was visible to a query over what had already happened. They would
  have raised the first time Grant used either - the defect waiting for its
  first user, which is the shape this repository keeps paying for.

  That is the argument for deriving a check from the code that COULD act
  rather than from the data that has. Recorded here because it is the reason
  0572's own drive block was not sufficient.

  Both performers already exist and take exactly what the payloads carry:
  `app.hq_document_move(p_document_id, p_project_id)` and
  `app.hq_document_restore(p_document_id, p_state)`. Only the dispatch was
  missing, again.
*/

do $patch$
declare
  v_src text;
  v_new text;
begin
  v_src := pg_get_functiondef('app.hq_undo'::regproc);

  if v_src ~ 'when ''document_move'' then' then
    raise exception 'hq_undo already knows document_move - applied twice?';
  end if;

  v_new := replace(
    v_src,
    '    else' || chr(10) ||
    '      -- A reversal naming something this function cannot perform is a bug in',
    '    -- The two no row could show, because nobody had used either yet' || chr(10) ||
    '    -- (0573). Found by reading the writers rather than the rows.' || chr(10) ||
    '    when ''document_move'' then' || chr(10) ||
    '      v_did := app.hq_document_move((v_args ->> ''p_document_id'')::uuid,' || chr(10) ||
    '                                    (v_args ->> ''p_project_id'')::uuid);' || chr(10) ||
    '    when ''document_restore'' then' || chr(10) ||
    '      v_did := app.hq_document_restore((v_args ->> ''p_document_id'')::uuid,' || chr(10) ||
    '                                       v_args ->> ''p_state'');' || chr(10) ||
    '    else' || chr(10) ||
    '      -- A reversal naming something this function cannot perform is a bug in');

  if v_new = v_src then
    raise exception 'the splice matched nothing - hq_undo''s else branch has been reworded';
  end if;

  execute v_new || ';';
end
$patch$;

/*
  THE PROPERTY, from the writers this time.

  0572 asserted it over the recorded rows and passed while these two were
  broken. The same question asked of the code that can act is the one that
  catches a reversal before anybody has performed it.
*/
do $drive$
declare
  v_press text := pg_get_functiondef('app.hq_undo'::regproc);
  v_missing text;
  v_n int := 0;
  v_seen int := 0;
  r record;
  m text;
begin
  for r in
    select p.proname, pg_get_functiondef(p.oid) as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and pg_get_functiondef(p.oid) ~ 'undo_offer\s*\('
       and p.proname <> 'undo_offer'
  loop
    for m in
      select (regexp_matches(r.src, '''action''\s*,\s*''([a-z_]+)''', 'g'))[1]
    loop
      v_seen := v_seen + 1;
      if v_press !~ ('when ''' || m || ''' then') then
        v_n := v_n + 1;
        v_missing := concat_ws(', ', v_missing, m || ' (app.' || r.proname || ')');
      end if;
    end loop;
  end loop;

  if v_seen = 0 then
    raise exception 'no writer names a reversal at all - this check proved nothing';
  end if;
  if v_n > 0 then
    raise exception 'hq_undo still cannot perform % offered reversal(s): %', v_n, v_missing;
  end if;
end
$drive$;
