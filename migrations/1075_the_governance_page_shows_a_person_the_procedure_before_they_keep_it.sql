-- 1075 - The Governance page shows a person the procedure a skill proposal contains, before they are asked to keep it (Hermes, M8).
--
-- app.hq_governance listed what the office noticed with one sentence and the kind of offer, and never the offer itself. For a rule that is
-- the sentence; for a skill proposed from a Hermes run the sentence ("Hermes wrote a procedure ...") says nothing about WHAT the procedure
-- is, so a person would be asked to press Accept on text they could not read. That is the defect this closes: review means reading.
--
-- For suggestions of kind 'engine.skill' ONLY, each noticed row now carries `skill`: { name, when, procedure, tools, dropped, source }, read
-- from the stored offer (the same row the press re-reads, 1073). Every other row carries `skill: null`. Nothing else in the payload changes,
-- the function's signature, owner and search path are untouched, and a page that does not know the key ignores it. Spliced from the LIVE
-- definition with the anchor asserted.
--
-- The text is untrusted (it may have been written by a model that read something hostile): it is returned as data and the page renders it
-- escaped, in a plain block, never as markup.
--
-- ROLLBACK. Restore app.hq_governance from its previous definition (the last migration that changed it); the extra key is simply absent.

do $splice$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('app.hq_governance(uuid,integer)'::regprocedure);
  v_new := replace(v_def,
    E'               ''at'', s.raised_at\n             ) order by (s.state = ''open'') desc, s.weight desc, s.raised_at desc),',
    E'               ''at'', s.raised_at,\n               ''skill'', case when s.kind = ''engine.skill'' then jsonb_build_object(\n                 ''name'', s.offer_args ->> ''name'', ''when'', s.offer_args ->> ''when'', ''procedure'', s.offer_args ->> ''procedure'',\n                 ''tools'', coalesce(s.offer_args -> ''tools'', ''[]''::jsonb), ''dropped'', coalesce(s.offer_args -> ''dropped'', ''[]''::jsonb),\n                 ''source'', s.offer_args ->> ''source'') else null end\n             ) order by (s.state = ''open'') desc, s.weight desc, s.raised_at desc),');
  if v_new = v_def then raise exception '1075: hq_governance anchor did not land'; end if;
  execute v_new;
end
$splice$;
