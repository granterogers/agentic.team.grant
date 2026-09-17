/*
  0474 — 291 impediments that are not requests, and a title that reads wrong

  The proposal round ran for the first time (0473) and the office's real asks
  arrived. Seven of them were this:

      Finance Director cannot an answer that matches its own evidence

  `public.job_impediments` holds 331 rows of kind `not_capable`, and 291 of
  them are exactly that string: #185's coherence gate refusing an answer, which
  is the gate WORKING. The other two spellings are the same class — "an answer
  the database will accept" and "an answer at all".

  **Grant cannot grant any of them.** There is no tool to give, no permission
  to approve and no material to supply; the office failed to write something
  coherent and retried. Put in front of him as a proposal it is noise on the
  page built to make the office legible — the sixth instance of that in
  CLAUDE.md and the second this evening.

  So `raise_proposals` skips `not_capable`. The other five kinds are all things
  a person can act on: a tool to grant, a skill to build, material to connect,
  a permission to give, a reading to choose. `not_capable` is the office
  talking about itself, and where that belongs is the impediment list on the
  same page — "tried and could not" (#211) — which already shows it.

  The title changes with it. `format('%s cannot %s')` assumes `needed` is a
  verb phrase, and half of them are noun phrases, so the page read "Finance
  Director cannot an answer". `could not:` is right for both.

  Spliced from the live definition rather than transcribed: this function is
  90 lines and only two of them change.
*/

do $splice$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'raise_proposals';

  if position('where staff_slug is not null' in v_def) = 0 then
    raise exception '0474 cannot find the tally loop it means to narrow';
  end if;
  v_def := replace(
    v_def,
    'where staff_slug is not null',
    -- `not_capable` is the office failing to produce its own output, which is
    -- never an ask for Grant. Every other kind names something he can act on.
    'where staff_slug is not null and t.kind <> ''not_capable''');

  if position('format(''%s cannot %s''' in v_def) = 0 then
    raise exception '0474 cannot find the title it means to correct';
  end if;
  v_def := replace(v_def, 'format(''%s cannot %s''', 'format(''%s could not: %s''');

  -- pg_get_functiondef emits no trailing semicolon. Recorded twice; third.
  execute v_def || ';';
end
$splice$;

/*
  And the rows that are already there. They were raised by the first run of
  the duty and by suites; none of them is answerable.
*/
do $sweep$
declare v_gone integer;
begin
  delete from public.proposals
   where kind = 'not_capable' and state = 'open';
  get diagnostics v_gone = row_count;
  raise notice '0474 removed % unanswerable proposal(s)', v_gone;
end
$sweep$;

comment on function app.raise_proposals(integer, integer, boolean) is
  'Turn recurring impediments into proposals Grant can answer (#49). Skips '
  'not_capable: an agent that could not write a coherent answer is an '
  'engineering signal, not a request (0474).';
